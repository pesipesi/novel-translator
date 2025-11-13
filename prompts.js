/**
 * システムプロンプトを生成する関数
 * @param {string} text - 小説の原文
 * @param {string} [bookTitle] - 小説のタイトル（任意）
 * @returns {string} - 生成されたシステムプロンプト
 */
const getSystemPrompt = (text, bookTitle) => {
  let prompt = `<novel>タグで小説の原文を渡します。AIは翻訳家として小説の翻訳に関するタスクを行います。<novel>${text}</novel>`;
  if (bookTitle) {
    prompt += `\n小説のタイトルは「${bookTitle}」です。`;
  }
  return prompt;
};

/**
 * 要約生成用のプロンプトを生成する関数
 * @param {string} sourceLang - 翻訳元の言語
 * @param {string} targetLang - 翻訳先の言語
 * @param {string} bookTitle - 小説のタイトル
 * @returns {string} - 生成された要約プロンプト
 */
const getSummaryPrompt = (sourceLang, targetLang, bookTitle) => {
  return `小説の原文を${sourceLang}から${targetLang}で140字から500字程度に要約してください。必要があれば小説のタイトルである${bookTitle}も要約の参考にしてください。小説の原文とタイトルの情報だけを要約の参考にしてください。改行は<br>タグで記載してください。`;
};

/**
 * 登場人物紹介生成用のプロンプトを生成する関数
 * @param {string} sourceLang - 翻訳元の言語
 * @param {string} targetLang - 翻訳先の言語
 * @returns {string} - 生成された登場人物紹介プロンプト
 */
const getCharactersPrompt = (sourceLang, targetLang) => {
  return `小説の原文から主要なキャラクターを抽出し、${targetLang}で2-3行程度で紹介してください。フォーマットは"人物:説明"という形にして、それ以外の文章を出力してはいけません。人物ごとに<br><br>で改行してください。`;
};

/**
 * 段落分割用のプロンプトを生成する関数
 * @param {string} sourceLang - 翻訳元の言語
 * @returns {string} - 生成された段落分割プロンプト
 */
const getParagraphPrompt = (sourceLang) => {
  return `小説の原文を内容にしたがって${sourceLang}で自然な段落ごとに分割してください。各段落は小説の原文の意味やストーリーのまとまりを考慮して分けてください。出力はJSON配列で、各要素が1つの段落テキストとなるようにしてください。小説の原文に説明や余計な文章の追加や削除は行わず、純粋なJSON配列のみを出力してください。`;
};

/**
 * 翻訳用のプロンプトを生成する関数
 * @param {string} paragraph - 翻訳対象の段落
 * @param {string} sourceLang - 翻訳元の言語
 * @param {string} targetLang - 翻訳先の言語
 * @returns {string} - 生成された翻訳プロンプト
 */
const getTranslationPrompt = (paragraph, sourceLang, targetLang) => {
  return `<paragraph>タグで段落を渡します。段落を${sourceLang}から${targetLang}へ翻訳してください。小説の原文を参考にして前後の文脈を理解したうえで、自然な言葉づかいで表現は文学的にしてください。ただし、原文に忠実に沿った意味で翻訳してください。<paragraph>${paragraph}</paragraph>`;
};

// 各プロンプト生成関数をモジュールとしてエクスポートします。
module.exports = {
  getSystemPrompt,
  getSummaryPrompt,
  getCharactersPrompt,
  getParagraphPrompt,
  getTranslationPrompt,
};
