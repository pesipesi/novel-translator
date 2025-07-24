document.addEventListener('DOMContentLoaded', () => {
  // temperatureスライダー表示値連動
  const tempSlider = document.getElementById('temperature');
  const tempValue = document.getElementById('temperatureValue');
  if (tempSlider && tempValue) {
    tempSlider.addEventListener('input', () => {
      tempValue.textContent = tempSlider.value;
    });
  }
  // クリップボードボタン取得
  const copySummaryBtn        = document.getElementById('copySummaryBtn');
  const copyCharactersBtn     = document.getElementById('copyCharactersBtn');
  const copyTranslationAllBtn = document.getElementById('copyTranslationAllBtn');
  const copyTranslationParaBtn= document.getElementById('copyTranslationParaBtn');
  const copyOriginalAllBtn    = document.getElementById('copyOriginalAllBtn');
  const copyOriginalParaBtn   = document.getElementById('copyOriginalParaBtn');
  // クリップボードコピー共通関数
  function copyToClipboard(text) {
    if (!navigator.clipboard) {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } else {
      navigator.clipboard.writeText(text);
    }
  }

  // 要約コピー
  if (copySummaryBtn) {
    copySummaryBtn.addEventListener('click', () => {
      copyToClipboard(summaryDiv.innerText);
    });
  }
  // 登場人物コピー
  if (copyCharactersBtn) {
    copyCharactersBtn.addEventListener('click', () => {
      copyToClipboard(charactersDiv.innerText);
    });
  }
  // 翻訳後全文コピー
  if (copyTranslationAllBtn) {
    copyTranslationAllBtn.addEventListener('click', () => {
      copyToClipboard(translatedLines.join('\n\n'));
    });
  }
  // 原文全文コピー
  if (copyOriginalAllBtn) {
    copyOriginalAllBtn.addEventListener('click', () => {
      copyToClipboard(originalParagraphs.join('\n\n'));
    });
  }
  // 翻訳後段落コピー
  if (copyTranslationParaBtn) {
    copyTranslationParaBtn.addEventListener('click', () => {
      // 段落選択UI: promptで番号入力
      const idx = prompt('コピーしたい段落番号を入力してください (1〜' + translatedLines.length + ')');
      const n = parseInt(idx);
      if (!isNaN(n) && n >= 1 && n <= translatedLines.length) {
        copyToClipboard(translatedLines[n-1]);
      }
    });
  }
  // 原文段落コピー
  if (copyOriginalParaBtn) {
    copyOriginalParaBtn.addEventListener('click', () => {
      const idx = prompt('コピーしたい段落番号を入力してください (1〜' + originalParagraphs.length + ')');
      const n = parseInt(idx);
      if (!isNaN(n) && n >= 1 && n <= originalParagraphs.length) {
        copyToClipboard(originalParagraphs[n-1]);
      }
    });
  }
  const form             = document.getElementById('translateForm');
  const resultsSection   = document.getElementById('results');
  const statusDiv        = document.getElementById('status');
  const summaryDiv       = document.getElementById('summary');
  const charactersDiv    = document.getElementById('characters');
  const translationDiv   = document.getElementById('translation');
  const toggleBtn        = document.getElementById('toggleParallel');

  let originalParagraphs = [];
  let translatedLines = [];
  let parallel        = false;
  let modelParams     = {};

  // フォーム送信（初回翻訳）
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    resultsSection.style.display = 'block';
    statusDiv.textContent = '要約処理中(1/4)...';
    const progressBar = document.getElementById('progressBar');
    if (progressBar) progressBar.value = 0;

    const formData = new FormData(form);
    // 高精度チェックボックスの値を追加
    const highPrecision = document.getElementById('highPrecision');
    if (highPrecision) {
      formData.set('highPrecision', highPrecision.checked ? 'true' : 'false');
    }
    // temperatureスライダーの値を追加
    const tempSlider = document.getElementById('temperature');
    if (tempSlider) {
      formData.set('temperature', tempSlider.value);
    }
    try {
      // 要約処理中...
      await new Promise(r => setTimeout(r, 300));
      if (progressBar) progressBar.value = 25;
      statusDiv.textContent = '登場人物処理中(2/4)...';
      await new Promise(r => setTimeout(r, 300));
      if (progressBar) progressBar.value = 50;
      statusDiv.textContent = '段落分割処理中(3/4)...';
      await new Promise(r => setTimeout(r, 300));
      if (progressBar) progressBar.value = 75;
      statusDiv.textContent = '翻訳処理中(4/4)...';

      // fetch開始
      const resp = await fetch('/translate', {
        method: 'POST',
        body: formData
      });
      const data = await resp.json();
      if (!data.success) {
        statusDiv.textContent = 'エラー: ' + data.error;
        if (progressBar) progressBar.value = 0;
        return;
      }

      // Bedrock分割の段落をそのまま使う
      if (Array.isArray(data.originalParagraphs) && data.originalParagraphs.length > 0) {
        originalParagraphs = data.originalParagraphs;
      } else if (Array.isArray(data.originalLines)) {
        originalParagraphs = data.originalLines;
      } else {
        originalParagraphs = [];
      }
      // 翻訳後もサーバーから段落配列で受けてそのまま使う
      if (Array.isArray(data.translatedLines)) {
        translatedLines = data.translatedLines;
      } else if (typeof data.translatedLines === 'string') {
        translatedLines = [data.translatedLines];
      } else {
        translatedLines = Array(originalParagraphs.length).fill('');
      }
      let paragraphWarning = '';
      if (translatedLines.length !== originalParagraphs.length) {
        paragraphWarning = `⚠️ 翻訳後の段落数(${translatedLines.length})が原文(${originalParagraphs.length})と一致しません。`;
        translatedLines = Array(originalParagraphs.length).fill(translatedLines.join('\n'));
      }

      modelParams = {
        modelId:    formData.get('modelId'),
        region:     formData.get('region'),
        apiKey:     formData.get('apiKey'),
        sourceLang: formData.get('sourceLang'),
        targetLang: formData.get('targetLang')
      };

      // usageがundefinedの場合でも0で初期化
      const inputTokens = (data.usage && typeof data.usage.inputTokens === 'number') ? data.usage.inputTokens : 0;
      const outputTokens = (data.usage && typeof data.usage.outputTokens === 'number') ? data.usage.outputTokens : 0;
      const cacheReadTokens = (data.usage && typeof data.usage.cacheReadInputTokens === 'number') ? data.usage.cacheReadInputTokens : 0;
      const cacheWriteTokens = (data.usage && typeof data.usage.cacheWriteInputTokens === 'number') ? data.usage.cacheWriteInputTokens : 0;
      const cost = (data.usage && typeof data.usage.cost === 'string') ? data.usage.cost : '0.000000';
      if (progressBar) progressBar.value = 100;
      statusDiv.innerHTML = `成功<br>
        入力トークン: ${inputTokens}<br>
        出力トークン: ${outputTokens}<br>
        cacheReadトークン: ${cacheReadTokens}<br>
        cacheWriteトークン: ${cacheWriteTokens}<br>
        コスト目安: $${cost} <br>
        (入力:$0.000003 出力:$0.000015 cacheRead:$0.0000003 cacheWrite:$0.0000375 換算)`;
      if (paragraphWarning) {
        statusDiv.innerHTML += `<br><span style='color:#c00;font-weight:bold;'>${paragraphWarning}</span>`;
      }
      // 作者名・タイトル表示
      if (window.setNovelMeta) {
        window.setNovelMeta(data.authorName, data.bookTitle);
      }
      // <br>タグをHTMLとして解釈して表示
      summaryDiv.innerHTML    = data.summary;
      charactersDiv.innerHTML = data.characters;
      renderTranslation();
    } catch (err) {
      statusDiv.textContent = 'エラー: ' + err.message;
    }
  });

  // 対訳トグル
  toggleBtn.addEventListener('click', () => {
    parallel = !parallel;
    toggleBtn.textContent = parallel ? '通常表示' : '対訳表示';
    renderTranslation();
  });


  // 本文を行ごとに描画
  function renderTranslation() {
    translationDiv.innerHTML = '';
    originalParagraphs.forEach((orig, i) => {
      const div = document.createElement('div');
      div.className = 'paragraph';

      const num = document.createElement('span');
      num.className = 'paragraph-number';
      num.textContent = (i + 1) + '.';
      div.appendChild(num);

      if (parallel) {
        // 対訳表示: 左=原文, 右=翻訳文
        const flexDiv = document.createElement('div');
        flexDiv.style.display = 'flex';
        flexDiv.style.gap = '2em';

        const oDiv = document.createElement('div');
        oDiv.textContent = orig;
        oDiv.style.fontStyle = 'italic';
        oDiv.style.whiteSpace = 'pre-line';
        oDiv.style.flex = '1';
        oDiv.style.borderRight = '1px solid #ccc';
        oDiv.style.paddingRight = '1em';

        const tDiv = document.createElement('div');
        tDiv.textContent = translatedLines[i] || '';
        tDiv.style.whiteSpace = 'pre-line';
        tDiv.style.flex = '1';
        tDiv.style.paddingLeft = '1em';

        flexDiv.appendChild(oDiv);
        flexDiv.appendChild(tDiv);
        div.appendChild(flexDiv);
      } else {
        // 通常表示: 翻訳文のみ
        const tDiv = document.createElement('div');
        tDiv.textContent = translatedLines[i] || '';
        tDiv.style.whiteSpace = 'pre-line';
        div.appendChild(tDiv);
      }

      // ...再翻訳ボタン削除...

      translationDiv.appendChild(div);
    });
  }
});