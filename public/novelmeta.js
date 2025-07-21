// 作者名・タイトル表示用
window.setNovelMeta = function(author, title) {
  const metaDiv = document.getElementById('novelMeta');
  if (!metaDiv) return;
  metaDiv.innerHTML = '';
  if (author) metaDiv.innerHTML += `<span class="novel-author">作者: ${author}</span> `;
  if (title)  metaDiv.innerHTML += `<span class="novel-title">タイトル: ${title}</span>`;
};
