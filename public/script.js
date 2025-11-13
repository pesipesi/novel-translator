document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Elements ---
  const form = document.getElementById('translateForm');
  const resultsSection = document.getElementById('results');
  const statusDiv = document.getElementById('status');
  const summaryDiv = document.getElementById('summary');
  const charactersDiv = document.getElementById('characters');
  const translationDiv = document.getElementById('translation');
  const toggleBtn = document.getElementById('toggleParallel');
  const progressBar = document.getElementById('progressBar');
  const tempSlider = document.getElementById('temperature');
  const tempValue = document.getElementById('temperatureValue');
  const highPrecisionCheck = document.getElementById('highPrecision');

  // --- State ---
  let originalParagraphs = [];
  let translatedLines = [];
  let isParallelView = false;

  // --- Utility Functions ---
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).catch(err => {
      console.error('Failed to copy text: ', err);
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    });
  };

  const setupCopyButton = (buttonId, getText) => {
    const button = document.getElementById(buttonId);
    if (button) {
      button.addEventListener('click', () => {
        const text = getText();
        if (text) {
          copyToClipboard(text);
        }
      });
    }
  };

  // --- Event Listeners ---
  if (tempSlider && tempValue) {
    tempSlider.addEventListener('input', () => {
      tempValue.textContent = tempSlider.value;
    });
  }

  form.addEventListener('submit', handleFormSubmit);

  toggleBtn.addEventListener('click', () => {
    isParallelView = !isParallelView;
    toggleBtn.textContent = isParallelView ? '通常表示' : '対訳表示';
    renderTranslation();
  });

  // --- Clipboard Buttons Setup ---
  setupCopyButton('copySummaryBtn', () => summaryDiv.innerText);
  setupCopyButton('copyCharactersBtn', () => charactersDiv.innerText);
  setupCopyButton('copyTranslationAllBtn', () => translatedLines.join('\n\n'));
  setupCopyButton('copyOriginalAllBtn', () => originalParagraphs.join('\n\n'));
  setupCopyButton('copyTranslationParaBtn', () => {
    const idx = prompt(`コピーしたい段落番号を入力してください (1〜${translatedLines.length})`);
    const n = parseInt(idx, 10);
    return (n >= 1 && n <= translatedLines.length) ? translatedLines[n - 1] : null;
  });
  setupCopyButton('copyOriginalParaBtn', () => {
    const idx = prompt(`コピーしたい段落番号を入力してください (1〜${originalParagraphs.length})`);
    const n = parseInt(idx, 10);
    return (n >= 1 && n <= originalParagraphs.length) ? originalParagraphs[n - 1] : null;
  });

  // --- Core Functions ---
  async function handleFormSubmit(e) {
    e.preventDefault();
    resultsSection.style.display = 'block';
    
    updateProgress(0, '要約処理中(1/4)...');
    
    const formData = new FormData(form);
    formData.set('highPrecision', highPrecisionCheck.checked ? 'true' : 'false');
    formData.set('temperature', tempSlider.value);

    try {
      // Simulate progress for user feedback
      await new Promise(r => setTimeout(r, 300));
      updateProgress(25, '登場人物処理中(2/4)...');
      await new Promise(r => setTimeout(r, 300));
      updateProgress(50, '段落分割処理中(3/4)...');
      await new Promise(r => setTimeout(r, 300));
      updateProgress(75, '翻訳処理中(4/4)...');

      const response = await fetch('/translate', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'サーバーで不明なエラーが発生しました。');
      }

      displayResults(data);

    } catch (err) {
      updateProgress(0, `エラー: ${err.message}`);
    }
  }

  function updateProgress(value, text) {
    if (progressBar) progressBar.value = value;
    if (statusDiv) statusDiv.innerHTML = text;
  }

  function displayResults(data) {
    originalParagraphs = data.originalParagraphs || [];
    translatedLines = data.translatedLines || [];

    let paragraphWarning = '';
    if (translatedLines.length !== originalParagraphs.length) {
      paragraphWarning = `⚠️ 翻訳後の段落数(${translatedLines.length})が原文(${originalParagraphs.length})と一致しません。`;
      // To prevent rendering errors, create an array of the same length
      const filledTranslated = Array(originalParagraphs.length).fill('');
      translatedLines.forEach((line, i) => {
        if (i < filledTranslated.length) filledTranslated[i] = line;
      });
      translatedLines = filledTranslated;
    }

    const { inputTokens = 0, outputTokens = 0, cacheReadInputTokens = 0, cacheWriteInputTokens = 0, cost = '0.000000' } = data.usage || {};
    
    let statusHTML = `成功<br>
      入力トークン: ${inputTokens}<br>
      出力トークン: ${outputTokens}<br>
      cacheReadトークン: ${cacheReadInputTokens}<br>
      cacheWriteトークン: ${cacheWriteInputTokens}<br>
      コスト目安: ${cost} <br>
      (入力:$0.000003 出力:$0.000015 cacheRead:$0.0000003 cacheWrite:$0.0000375 換算)`;
    
    if (paragraphWarning) {
      statusHTML += `<br><span style='color:#c00;font-weight:bold;'>${paragraphWarning}</span>`;
    }
    
    updateProgress(100, statusHTML);

    if (window.setNovelMeta) {
      window.setNovelMeta(data.authorName, data.bookTitle);
    }

    summaryDiv.innerHTML = data.summary || '';
    charactersDiv.innerHTML = data.characters || '';
    renderTranslation();
  }

  function renderTranslation() {
    translationDiv.innerHTML = '';
    originalParagraphs.forEach((orig, i) => {
      const div = document.createElement('div');
      div.className = 'paragraph';

      const num = document.createElement('span');
      num.className = 'paragraph-number';
      num.textContent = `${i + 1}.`;
      div.appendChild(num);

      const contentDiv = document.createElement('div');
      contentDiv.style.whiteSpace = 'pre-line';

      if (isParallelView) {
        contentDiv.style.display = 'flex';
        contentDiv.style.gap = '2em';

        const origDiv = document.createElement('div');
        origDiv.textContent = orig;
        origDiv.style.flex = '1';
        origDiv.style.borderRight = '1px solid #ccc';
        origDiv.style.paddingRight = '1em';
        origDiv.style.fontStyle = 'italic';

        const transDiv = document.createElement('div');
        transDiv.textContent = translatedLines[i] || '';
        transDiv.style.flex = '1';
        transDiv.style.paddingLeft = '1em';

        contentDiv.appendChild(origDiv);
        contentDiv.appendChild(transDiv);
      } else {
        contentDiv.textContent = translatedLines[i] || '';
      }
      
      div.appendChild(contentDiv);
      translationDiv.appendChild(div);
    });
  }
});