const express = require('express');
const multer = require('multer');
const cors = require('cors');
const bodyParser = require('body-parser');
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const fs = require('fs-extra');

// Bedrock Claude 3 Sonnet: $0.003 per 1K input tokens, $0.015 per 1K output tokens
const COST_PER_INPUT_TOKEN = 0.003 / 1000;   // $0.000003
const COST_PER_OUTPUT_TOKEN = 0.015 / 1000;  // $0.000015

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// 小説全体の翻訳・要約・登場人物抽出
app.post('/translate', upload.single('novelFile'), async (req, res) => {
  try {
    const {
      modelId, region,
      accessKeyId, secretAccessKey,
      sourceLang, targetLang,
      authorName, bookTitle,
      highPrecision,
      temperature
    } = req.body;
    const text = req.file.buffer.toString('utf-8');

    // 各タスク用プロンプトを組み立て
    const system_prompt = `<novel>タグで翻訳前の小説の文章を渡します。AIは小説の文章に関するタスクを行います。<novel>${text}</novel>`;
    const summaryPrompt = `小説の文章を${sourceLang}から${targetLang}で140字から500字程度に要約してください。必要があれば小説のタイトルである${bookTitle}も要約の参考にしてください。小説の文章とタイトルの情報だけを要約の参考にしてください。改行は<br>タグで記載してください。`;
    const charactersPrompt = `主要なキャラクターを抽出し、${targetLang}で2-3行程度で紹介してください。フォーマットは"人物:説明"という形にして、それ以外の文章を出力してはいけません。人物ごとに<br><br>で改行してください。`;
    // 段落分割プロンプト
    const paragraphPrompt = `翻訳前の小説の文章を内容に従って自然な段落ごとに分割してください。各段落は原文の意味やストーリーのまとまりを考慮して分けてください。出力はJSON配列で、各要素が1つの段落テキストとなるようにしてください。説明や余計な文章、バッククォートやコードブロック、"json"などは一切付けず、純粋なJSON配列のみを出力してください。`;
    // 翻訳プロンプト（各段落ごとに使う）
    const translationPromptSingle = (paragraph) => `<paragraph>タグで段落を渡します。翻訳前の小説の文章を参考にしながら、段落を${sourceLang}から${targetLang}へ翻訳してください。自然な言葉づかいで表現は文学的にしてください。ただし、原文から飛躍のある意味にしてはいけません。<paragraph>${paragraph}</paragraph>`;

    // Bedrock Converse API 呼び出し関数（cachePoint, cacheRead, cacheWrite対応）
    const converseBedrock = async ({prompt, messages}) => {
      const client = new BedrockRuntimeClient({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey
        }
      });

      const input = {
        modelId,
        system: [
          {
            text: system_prompt,
            cachePoint: {type: 'default'}
          }
        ],
        messages: messages || [
          {
            role: 'user',
            content: [
              {
                text: prompt
              }
            ]
          }
        ],
        inferenceConfig: {
            maxTokens: 40000,
            temperature: (typeof temperature !== 'undefined' && temperature !== null) ? Number(temperature) : 0.4
        }
      };

      const command = new ConverseCommand(input);
      const response = await client.send(command);
      // content配列の中身も明示的にログ出力
      if (response.output && response.output.message && Array.isArray(response.output.message.content)) {
        console.log('Bedrock Converse response content array:', response.output.message.content);
      }
      console.log('Bedrock Converse response:', response);
      // bedrock.logに追記
      try {
        await fs.appendFile('bedrock.log', JSON.stringify(response, null, 2) + '\n');
      } catch (e) {
        console.error('bedrock.logへの書き込み失敗:', e);
      }

      // レスポンス構造に合わせて処理
      if (!response.output || !response.output.message || !response.output.message.content) {
        return {
          error: 'Bedrock Converse APIレスポンスにmessage.contentが含まれていません',
          raw: response
        };
      }
      // contentは配列（type: text, text: ...）
      let content = '';
      const arr = response.output.message.content;
      if (Array.isArray(arr)) {
        // type: text優先、なければtextプロパティ
        const textObj = arr.find(c => c.type === 'text' && typeof c.text === 'string');
        if (textObj) {
          content = textObj.text;
        } else {
          // typeがない場合もtextプロパティを探す
          const anyTextObj = arr.find(c => typeof c.text === 'string');
          if (anyTextObj) content = anyTextObj.text;
        }
      }
      // トークン数はoutput.usage.inputTokens/outputTokens または usage.inputTokens/outputTokens
      let inputTokens = 0;
      let outputTokens = 0;
      if (response.output && response.output.usage) {
        inputTokens = response.output.usage.inputTokens ?? 0;
        outputTokens = response.output.usage.outputTokens ?? 0;
      }
      // usageがoutputの外側にある場合も考慮
      if (response.usage) {
        if (typeof response.usage.inputTokens === 'number') inputTokens = response.usage.inputTokens;
        if (typeof response.usage.outputTokens === 'number') outputTokens = response.usage.outputTokens;
      }

      // stopReason判定
      let stopReason_check = false;
      if (response.stopReason) {
        if (response.stopReason === 'max_tokens') stopReason_check = true;
      }
      return { content, inputTokens, outputTokens, output: response.output, stopReason_check };
    };

    // 1. summary: cacheWriteで小説本文をキャッシュ
    const summaryResp = await converseBedrock({
      prompt: summaryPrompt,
    });
    if (summaryResp.error) return res.status(500).json({ success: false, error: summaryResp.error, raw: summaryResp.raw });

    // 2. characters: cacheReadでキャッシュ利用、messages履歴はcharactersPromptのみ
    const charactersMessages = [
      {
        role: 'user',
        content: [ 
          {
            text: charactersPrompt
          } 
        ]
      }
    ];
    const charactersResp = await converseBedrock({
      prompt: charactersPrompt,
      messages: charactersMessages
    });
    if (charactersResp.error) return res.status(500).json({ success: false, error: charactersResp.error, raw: charactersResp.raw });

    // 3. 段落分割: Bedrockで段落配列を取得
    const paragraphResp = await converseBedrock({
      prompt: paragraphPrompt
    });
    if (paragraphResp.error) return res.status(500).json({ success: false, error: paragraphResp.error, raw: paragraphResp.raw });
    // 段落配列を抽出
    let originalParagraphs = [];
    let paraContent = paragraphResp.content || '';
    // コードブロックやバッククォート、"json"などを除去
    paraContent = paraContent.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
      // JSON配列としてパース
      originalParagraphs = JSON.parse(paraContent);
      if (!Array.isArray(originalParagraphs)) throw new Error('not array');
    } catch (e) {
      // パース失敗時は1段落扱い
      originalParagraphs = [paragraphResp.content];
    }
    // 空要素除去
    originalParagraphs = originalParagraphs.map(s => (typeof s === 'string' ? s.trim() : '')).filter(s => s);
    if (originalParagraphs.length === 0) originalParagraphs = [text];

    // 4. 各段落ごとに翻訳
    let translatedLines = [];
    let translationTokens = {input:0,output:0};
    let translationDebugs = [];
    for (let i = 0; i < originalParagraphs.length; i++) {
      const para = originalParagraphs[i];
      let paraTranslation = '';
      let paraInputTokens = 0;
      let paraOutputTokens = 0;
      // 文脈用: これまでの原文・翻訳済み段落をmessages履歴に含める（高精度モードのみ）
      let translationMessages = [];
      if (highPrecision === 'true' || highPrecision === true) {
        // 1段落目はそのまま
        if (i === 0) {
          translationMessages.push({
            role: 'user',
            content: [
              {
                text: translationPromptSingle(para)
              }
            ]
          });
        } else {
          // 2段落目以降は前回までの原文・翻訳済みを履歴として渡す
          for (let j = 0; j < i; j++) {
            translationMessages.push({
              role: 'user',
              content: [
                {
                  text: `原文: ${originalParagraphs[j]}`
                },
              ],
              cachePoint: {type: 'default'}
            });
            translationMessages.push({
              role: 'assistant',
              content: [
                {
                  text: translatedLines[j] || ''
                }
              ]
            });
          }
          // 今回の段落を翻訳指示付きで渡す
          translationMessages.push({
            role: 'user',
            content: [
              {
                text: translationPromptSingle(para)
              }
            ]
          });
        }
      } else {
        // 高精度でなければ常にその段落のみ
        translationMessages.push({
          role: 'user',
          content: [
            {
              text: translationPromptSingle(para)
            }
          ]
        });
      }
      let continueFlag = true;
      let loopCount = 0;
      while (continueFlag && loopCount < 3) {
        loopCount++;
        const translationResp = await converseBedrock({
          prompt: translationPromptSingle(para),
          messages: translationMessages
        });
        if (translationResp.error) return res.status(500).json({ success: false, error: translationResp.error, raw: translationResp.raw });
        translationDebugs.push(translationResp);
        paraTranslation += translationResp.content || '';
        paraInputTokens += translationResp.inputTokens || 0;
        paraOutputTokens += translationResp.outputTokens || 0;
        const { stopReason_check } = translationResp;
        if (stopReason_check === true) {
          translationMessages.push({
            role: 'assistant',
            content: [
              {
                text: paraTranslation
              }
            ]
          });
        } else {
          continueFlag = false;
        }
      }
      translatedLines.push(paraTranslation);
      translationTokens.input += paraInputTokens;
      translationTokens.output += paraOutputTokens;
    }

    // Bedrockレスポンスのusage, content抽出（必ずtextを抽出）
    function extractText(resp) {
      if (resp.content) return resp.content;
      if (resp.output && resp.output.message && Array.isArray(resp.output.message.content)) {
        const arr = resp.output.message.content;
        // type: text優先、なければtextプロパティ
        const textObj = arr.find(c => c.type === 'text' && typeof c.text === 'string');
        if (textObj) return textObj.text;
        const anyTextObj = arr.find(c => typeof c.text === 'string');
        if (anyTextObj) return anyTextObj.text;
      }
      return '';
    }

    // input/output tokens合計
    function getTokens(resp) {
      // converseBedrock返却値にinputTokens/outputTokensが含まれる場合はそれを使う
      if (typeof resp.inputTokens === 'number' && typeof resp.outputTokens === 'number') {
        return {
          input: resp.inputTokens,
          output: resp.outputTokens
        };
      }
      // それ以外はBedrockレスポンスから抽出
      if (resp.output && resp.output.usage) {
        return {
          input: resp.output.usage.inputTokens || 0,
          output: resp.output.usage.outputTokens || 0
        };
      }
      return { input: 0, output: 0 };
    }
    const summaryTokens    = getTokens(summaryResp);
    const charactersTokens = getTokens(charactersResp);
    const paragraphTokens  = getTokens(paragraphResp);
    const totalInputTokens  = summaryTokens.input + charactersTokens.input + paragraphTokens.input + translationTokens.input;
    const totalOutputTokens = summaryTokens.output + charactersTokens.output + paragraphTokens.output + translationTokens.output;
    const cost = (totalInputTokens * COST_PER_INPUT_TOKEN) + (totalOutputTokens * COST_PER_OUTPUT_TOKEN);

    // summary, charactersも同様に抽出
    let summaryText    = extractText(summaryResp);
    let charactersText = extractText(charactersResp);

    // デバッグ用: レスポンス内容をstatus欄に一時表示
    const debugInfo = {
      summaryResp,
      charactersResp,
      paragraphResp,
      translationDebugs
    };

    res.json({
      success: true,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cost: cost.toFixed(6)
      },
      summary:    summaryText,
      characters: charactersText,
      originalParagraphs,
      translatedLines,
      authorName, // 追加
      bookTitle,  // 追加
      debugInfo // フロントで一時表示可能
    });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});


const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});