/**
 * 小説のメタ情報（作者名、タイトル）をページに表示する関数
 * @param {string} author - 作者名
 * @param {string} title - タイトル
 */
window.setNovelMeta = function(author, title) {
  // 'novelMeta' というIDを持つ要素を取得します。
  const metaDiv = document.getElementById('novelMeta');
  // 要素が存在しない場合は、何もせずに処理を終了します。
  if (!metaDiv) return;
  // 要素の内容を一旦空にします。
  metaDiv.innerHTML = '';
  // 作者名が指定されている場合、作者名を表示するHTMLを追加します。
  if (author) metaDiv.innerHTML += `<span class="novel-author">作者: ${author}</span> `;
  // タイトルが指定されている場合、タイトルを表示するHTMLを追加します。
  if (title)  metaDiv.innerHTML += `<span class="novel-title">タイトル: ${title}</span>`;
};
