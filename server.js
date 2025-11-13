// 必要なモジュールをインポートします。
const express = require('express'); // Webフレームワーク
const multer = require('multer'); // ファイルアップロード処理
const cors = require('cors'); // CORS（Cross-Origin Resource Sharing）設定
const bodyParser = require('body-parser'); // リクエストボディの解析
const { converseBedrock, calculateCost } = require('./bedrock.js'); // Bedrock API関連の関数
const {
  getSystemPrompt,
  getSummaryPrompt,
  getCharactersPrompt,
  getParagraphPrompt,
  getTranslationPrompt,
} = require('./prompts.js'); // プロンプト生成関数

// Expressアプリケーションを初期化します。
const app = express();
// ファイルアップロードをメモリ上で行うように設定します。
const upload = multer({ storage: multer.memoryStorage() });

// ミドルウェアを設定します。
app.use(cors()); // CORSを有効化
app.use(bodyParser.json()); // JSON形式のリクエストボディを解析
app.use(express.static('public')); // 'public'ディレクトリを静的ファイル配信用に設定

// '/translate' エンドポイント（小説全体の翻訳・要約・登場人物抽出）
app.post('/translate', upload.single('novelFile'), async (req, res) => {
  try {
    // リクエストボディとファイルから必要な情報を取得します。
    const {
      modelId, region,
      accessKeyId, secretAccessKey,
      sourceLang, targetLang,
      authorName, bookTitle,
      highPrecision,
      temperature
    } = req.body;
    const text = req.file.buffer.toString('utf-8'); // アップロードされたファイルをUTF-8で読み込み

    // Bedrock APIの基本設定を構築します。
    const bedrockConfig = {
      region,
      accessKeyId,
      secretAccessKey,
      modelId,
      temperature,
      system_prompt: getSystemPrompt(text, bookTitle),
    };

    // Bedrock APIを呼び出すためのヘルパー関数
    const runBedrockTask = (prompt) => {
      return converseBedrock({
        ...bedrockConfig,
        messages: [{ role: 'user', content: [{ text: prompt }] }],
      });
    };

    // 1. 要約生成、2. 登場人物抽出、3. 段落分割を並列で実行します。
    console.log('start summary, characters, paragraph...');
    const [summaryResp, charactersResp, paragraphResp] = await Promise.all([
      runBedrockTask(getSummaryPrompt(sourceLang, targetLang, bookTitle)),
      runBedrockTask(getCharactersPrompt(sourceLang, targetLang)),
      runBedrockTask(getParagraphPrompt(sourceLang)),
    ]);
    console.log('end summary, characters, paragraph...');

    // 段落分割の結果を解析し、段落の配列を抽出します。
    let originalParagraphs = [];
    let paraContent = paragraphResp.content || '';
    // 不要なマークダウン（```json ... ```）を削除します。
    paraContent = paraContent.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
      originalParagraphs = JSON.parse(paraContent);
      if (!Array.isArray(originalParagraphs)) throw new Error('not array');
    } catch (e) {
      // JSON解析に失敗した場合は、レスポンス全体を1つの段落として扱います。
      originalParagraphs = [paragraphResp.content];
    }
    // 各段落をトリムし、空の段落をフィルタリングします。
    originalParagraphs = originalParagraphs.map(s => (typeof s === 'string' ? s.trim() : '')).filter(s => s);
    // 段落が取得できなかった場合は、原文全体を1つの段落とします。
    if (originalParagraphs.length === 0) originalParagraphs = [text];

    // 4. 各段落ごとに翻訳を実行します。
    console.log('start translate...');
    let translatedLines = []; // 翻訳済みテキストを格納する配列
    let translationTokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }; // 翻訳のトークン使用量
    
    // 高精度モードのために、キャッシュポイントを挿入するインデックスを計算します。
    const totalParagraphs = originalParagraphs.length;
    const splitIndex2 = Math.floor(totalParagraphs / 4) * 1;
    const splitIndex3 = Math.floor(totalParagraphs / 4) * 2;
    const splitIndex4 = Math.floor(totalParagraphs / 4) * 3;

    // 各段落をループして翻訳します。
    for (let i = 0; i < originalParagraphs.length; i++) {
      const para = originalParagraphs[i];
      let translationMessages = [];

      // 高精度モードが有効な場合、過去の翻訳結果をコンテキストとして追加します。
      if (highPrecision === 'true' || highPrecision === true) {
        for (let j = 0; j < i; j++) {
          translationMessages.push({ role: 'user', content: [{ text: `原文: ${originalParagraphs[j]}` }] });
          const assistantContent = [{ text: translatedLines[j] || '' }];
          // 特定のインデックスでキャッシュポイントを挿入します。
          if (j === splitIndex2 || j === splitIndex3 || j === splitIndex4) {
            assistantContent.push({ cachePoint: { type: 'default' } });
          }
          translationMessages.push({ role: 'assistant', content: assistantContent });
        }
      }
      
      // 現在の段落の翻訳プロンプトを追加します。
      translationMessages.push({ role: 'user', content: [{ text: getTranslationPrompt(para, sourceLang, targetLang) }] });

      let paraTranslation = '';
      let continueFlag = true;
      let loopCount = 0;
      // `max_tokens` で停止した場合にループで続きを取得します（最大3回）。
      while (continueFlag && loopCount < 3) {
        loopCount++;
        const translationResp = await converseBedrock({ ...bedrockConfig, messages: translationMessages });
        
        paraTranslation += translationResp.content || '';
        // トークン使用量を加算します。
        translationTokens.inputTokens += translationResp.inputTokens || 0;
        translationTokens.outputTokens += translationResp.outputTokens || 0;
        translationTokens.cacheReadTokens += translationResp.cacheReadTokens || 0;
        translationTokens.cacheWriteTokens += translationResp.cacheWriteTokens || 0;

        // `max_tokens` で停止した場合は、現在の翻訳結果をコンテキストに追加してループを継続します。
        if (translationResp.stopReason_check === true) {
          translationMessages.push({ role: 'assistant', content: [{ text: paraTranslation }] });
        } else {
          continueFlag = false;
        }
      }
      translatedLines.push(paraTranslation);
    }
    console.log('end translate...');

    // 全体のトークン使用量を計算します。
    const totalUsage = {
      inputTokens: (summaryResp.inputTokens || 0) + (charactersResp.inputTokens || 0) + (paragraphResp.inputTokens || 0) + translationTokens.inputTokens,
      outputTokens: (summaryResp.outputTokens || 0) + (charactersResp.outputTokens || 0) + (paragraphResp.outputTokens || 0) + translationTokens.outputTokens,
      cacheReadInputTokens: (summaryResp.cacheReadTokens || 0) + (charactersResp.cacheReadTokens || 0) + (paragraphResp.cacheReadTokens || 0) + translationTokens.cacheReadTokens,
      cacheWriteInputTokens: (summaryResp.cacheWriteTokens || 0) + (charactersResp.cacheWriteTokens || 0) + (paragraphResp.cacheWriteTokens || 0) + translationTokens.cacheWriteTokens,
    };

    // 最終的なレスポンスをJSON形式で返します。
    res.json({
      success: true,
      usage: {
        ...totalUsage,
        cost: calculateCost(totalUsage) // 合計コストを計算
      },
      summary: summaryResp.content || '',
      characters: charactersResp.content || '',
      originalParagraphs,
      translatedLines,
      authorName,
      bookTitle,
    });
  } catch (error) {
    // エラーが発生した場合は、エラーメッセージをコンソールに出力し、500エラーを返します。
    console.error(error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// サーバーをポート3000で起動します。
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});