// AWS SDK for JavaScript v3 の Bedrock Runtime クライアントとストリーミングコマンドをインポートします。
const { BedrockRuntimeClient, ConverseStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
// ファイルシステムの操作を簡単にするための 'fs-extra' ライブラリをインポートします。
const fs = require('fs-extra');

// Bedrock Claude 3 Sonnet の料金設定
// 1000入力トークンあたり$0.003
const COST_PER_INPUT_TOKEN = 0.003 / 1000;   // $0.000003
// 1000出力トークンあたり$0.015
const COST_PER_OUTPUT_TOKEN = 0.015 / 1000;  // $0.000015
// キャッシュ読み取りのコスト
const COST_PER_CACHE_READ  = 0.0003 / 1000;
// キャッシュ書き込みのコスト
const COST_PER_CACHE_WRITE = 0.00375 / 1000;

/**
 * Bedrock Converse API を呼び出す関数（cachePoint, cacheRead, cacheWrite 対応）
 * @param {object} params - API呼び出しに必要なパラメータのオブジェクト
 * @param {string} params.region - AWSリージョン
 * @param {string} params.accessKeyId - AWSアクセスキーID
 * @param {string} params.secretAccessKey - AWSシークレットアクセスキー
 * @param {string} params.modelId - 使用するBedrockモデルのID
 * @param {string} params.system_prompt - システムプロンプト
 * @param {Array<object>} params.messages - 会話のメッセージ配列
 * @param {number} params.temperature - 生成テキストの多様性を制御する温度パラメータ
 * @returns {Promise<object>} - APIからのレスポンス（コンテンツ、トークン数など）を含むPromiseオブジェクト
 */
const converseBedrock = async ({ region, accessKeyId, secretAccessKey, modelId, system_prompt, messages, temperature }) => {
  console.log("converseBedrock start");
  // Bedrock Runtimeクライアントを初期化します。
  const client = new BedrockRuntimeClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  });

  // APIに渡す入力データを構築します。
  const input = {
    modelId,
    system: [
      { text: system_prompt },
      { cachePoint: { type: 'default' } } // キャッシュポイントを設定
    ],
    messages: messages,
    inferenceConfig: {
      maxTokens: 40000, // 最大出力トークン数
      temperature: (typeof temperature !== 'undefined' && temperature !== null) ? Number(temperature) : 0.4 // 温度パラメータ
    }
  };

  console.log("command exec");
  // ストリーミング用のコマンドを作成します。
  const command = new ConverseStreamCommand(input);
  console.log("get response");
  // コマンドを送信し、レスポンスを取得します。
  const response = await client.send(command);

  let content = ''; // 生成されたコンテンツを格納する変数
  let inputTokens = 0; // 入力トークン数
  let outputTokens = 0; // 出力トークン数
  let cacheReadTokens = 0; // キャッシュから読み取られたトークン数
  let cacheWriteTokens = 0; // キャッシュに書き込まれたトークン数
  let stopReason_check = false; // 停止理由が 'max_tokens' であったかどうかをチェックするフラグ

  // ストリーミングレスポンスを非同期に処理します。
  for await (const chunk of response.stream) {
    // コンテンツの差分があれば追加します。
    if (chunk.contentBlockDelta?.delta?.text) {
      content += chunk.contentBlockDelta.delta.text;
    }
    
    // メタデータに使用量情報があれば更新します。
    if (chunk.metadata?.usage) {
      const usage = chunk.metadata.usage;
      if (typeof usage.inputTokens === 'number') inputTokens = usage.inputTokens;
      if (typeof usage.outputTokens === 'number') outputTokens = usage.outputTokens;
      if (typeof usage.cacheReadInputTokens === 'number') cacheReadTokens = usage.cacheReadInputTokens;
      if (typeof usage.cacheWriteInputTokens === 'number') cacheWriteTokens = usage.cacheWriteInputTokens;
    }

    // 停止理由が 'max_tokens' であればフラグを立てます。
    if (chunk.messageStop?.stopReason === 'max_tokens') {
      stopReason_check = true;
    }
  }

  console.log('Bedrock Stream response content:', content);
  
  try {
    // ログデータを構築し、'bedrock.log' ファイルに追記します。
    const logData = { content, usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }, stopReason_check };
    await fs.appendFile('bedrock.log', JSON.stringify(logData, null, 2) + '\n');
  } catch (e) {
    console.error('bedrock.logへの書き込み失敗:', e);
  }

  // 処理結果を返します。
  return { content, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, stopReason_check };
};

/**
 * Bedrock API の利用料金を計算する関数
 * @param {object} usage - トークン使用量情報
 * @param {number} usage.inputTokens - 入力トークン数
 * @param {number} usage.outputTokens - 出力トークン数
 * @param {number} usage.cacheReadInputTokens - キャッシュ読み取りトークン数
 * @param {number} usage.cacheWriteInputTokens - キャッシュ書き込みトークン数
 * @returns {string} - 計算されたコスト（小数点以下6桁までの文字列）
 */
const calculateCost = (usage) => {
  const { inputTokens, outputTokens, cacheReadInputTokens, cacheWriteInputTokens } = usage;
  // 各トークン数に単価を掛けて合計コストを計算します。
  const cost = (inputTokens * COST_PER_INPUT_TOKEN)
            + (outputTokens * COST_PER_OUTPUT_TOKEN)
            + (cacheReadInputTokens * COST_PER_CACHE_READ)
            + (cacheWriteInputTokens * COST_PER_CACHE_WRITE);
  // コストを小数点以下6桁の文字列にフォーマットして返します。
  return cost.toFixed(6);
};

// `converseBedrock` と `calculateCost` 関数をモジュールとしてエクスポートします。
module.exports = {
  converseBedrock,
  calculateCost,
};
