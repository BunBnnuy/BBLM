// ── Library Scanner tab ───────────────────────────────────────────────────────

const scBtnPick     = document.getElementById('sc-btn-pick');
const scBtnScan     = document.getElementById('sc-btn-scan');
const scBtnCancel   = document.getElementById('sc-btn-cancel');
const scBtnCopyAll  = document.getElementById('sc-btn-copy-all');
const scFolderPath  = document.getElementById('sc-folder-path');
const scStatus      = document.getElementById('sc-status');
const scEmpty       = document.getElementById('sc-empty');
const scResults     = document.getElementById('sc-results');
const scResultsList = document.getElementById('sc-results-list');
const scResultsCount= document.getElementById('sc-results-count');
const scProgressWrap= document.getElementById('sc-progress-bar-wrap');
const scBar         = document.getElementById('sc-bar');
const scBarLabel    = document.getElementById('sc-bar-label');
const scPagBar      = document.getElementById('sc-pagination-bar');
const scPagInfo     = document.getElementById('sc-pag-info');
const scPagPages    = document.getElementById('sc-pag-pages');
const scBtnFirst    = document.getElementById('sc-btn-first');
const scBtnPrev     = document.getElementById('sc-btn-prev');
const scBtnNext     = document.getElementById('sc-btn-next');
const scBtnLast     = document.getElementById('sc-btn-last');
const scBtnClear    = document.getElementById('sc-btn-clear');

const SC_PAGE_SIZE = 10;

let scSelectedFolder = null;
let scScanning  = false;
let scAllResults = []; // { archive, content, node }  — node is the pre-built DOM element
let scPage = 1;

// ── Helpers ──────────────────────────────────────────────────────────────────

function scEsc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function scSetStatus(msg, type = '') {
  scStatus.textContent = msg;
  scStatus.className = 'sc-status' + (type ? ` sc-status--${type}` : '');
}

function scSetProgress(pct, label) {
  scBar.style.width = pct + '%';
  scBarLabel.textContent = label || '';
}

// ── Pagination ────────────────────────────────────────────────────────────────

function scTotalPages() {
  return Math.max(1, Math.ceil(scAllResults.length / SC_PAGE_SIZE));
}

function scRenderPage() {
  const total = scAllResults.length;
  const pages = scTotalPages();
  scPage = Math.min(Math.max(1, scPage), pages);

  const start = (scPage - 1) * SC_PAGE_SIZE;
  const end   = Math.min(start + SC_PAGE_SIZE, total);

  scResultsList.innerHTML = '';
  for (let i = start; i < end; i++) {
    scResultsList.appendChild(scAllResults[i].node);
  }
  // Scroll list back to top on page change
  scResultsList.scrollTop = 0;

  // Info
  scPagInfo.textContent = total === 0 ? '' : `${start + 1}–${end} of ${total}`;
  scResultsCount.textContent = `${total} result${total !== 1 ? 's' : ''}`;

  // Page buttons
  scPagPages.innerHTML = '';
  const windowSize = 5;
  let pageStart = Math.max(1, scPage - Math.floor(windowSize / 2));
  let pageEnd   = Math.min(pages, pageStart + windowSize - 1);
  if (pageEnd - pageStart + 1 < windowSize) pageStart = Math.max(1, pageEnd - windowSize + 1);

  for (let p = pageStart; p <= pageEnd; p++) {
    const btn = document.createElement('button');
    btn.className = 'btn-ghost pag-btn' + (p === scPage ? ' pag-btn--active' : '');
    btn.textContent = p;
    btn.disabled = p === scPage;
    btn.addEventListener('click', () => { scPage = p; scRenderPage(); });
    scPagPages.appendChild(btn);
  }

  scBtnFirst.disabled = scPage <= 1;
  scBtnPrev.disabled  = scPage <= 1;
  scBtnNext.disabled  = scPage >= pages;
  scBtnLast.disabled  = scPage >= pages;

  scPagBar.style.display = pages > 1 ? 'flex' : 'none';
}

scBtnFirst.addEventListener('click', () => { scPage = 1;             scRenderPage(); });
scBtnPrev .addEventListener('click', () => { scPage--;               scRenderPage(); });
scBtnNext .addEventListener('click', () => { scPage++;               scRenderPage(); });
scBtnLast .addEventListener('click', () => { scPage = scTotalPages(); scRenderPage(); });

// ── Build a result card (DOM only, not yet appended) ─────────────────────────

function scBuildResultNode(archive, content) {
  const item = document.createElement('div');
  item.className = 'sc-result-item';
  item.innerHTML = `
    <div class="sc-result-archive">
      <span class="sc-result-archive-icon">📦</span>
      <span class="sc-result-archive-path">${scEsc(archive)}</span>
      <button class="sc-result-copy" title="Copy path">⎘</button>
    </div>
    <div class="sc-result-content">
      <span class="sc-result-content-text">${scEsc(content)}</span>
    </div>
    <div class="sc-result-import-row">
      <input class="sc-result-url-input" type="url" placeholder="Origin URL (Booth, Gumroad…)" autocomplete="off" spellcheck="false" />
      <button class="sc-result-import-btn btn-primary">+ Add to Library</button>
    </div>
  `;

  item.querySelector('.sc-result-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(archive);
  });

  const urlInput  = item.querySelector('.sc-result-url-input');
  const importBtn = item.querySelector('.sc-result-import-btn');

  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    importBtn.textContent = '⏳ Importing…';

    const result = await window.api.scannerImportAsset({
      archivePath: archive,
      originUrl: urlInput.value.trim(),
    });

    if (result.ok) {
      importBtn.textContent = '✓ Added';
      importBtn.classList.remove('btn-primary');
      importBtn.classList.add('btn-secondary');
      urlInput.disabled = true;
    } else {
      importBtn.disabled = false;
      importBtn.textContent = '+ Add to Library';
      importBtn.title = result.error || 'Import failed';
      importBtn.style.borderColor = 'var(--accent)';
      importBtn.style.color = 'var(--accent)';
    }
  });

  return item;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function scSave() {
  window.api.scannerSaveResults(scAllResults.map(r => ({ archive: r.archive, content: r.content })));
}

async function scLoadSaved() {
  const saved = await window.api.scannerGetResults();
  if (!saved || saved.length === 0) return;
  for (const { archive, content } of saved) {
    const node = scBuildResultNode(archive, content);
    scAllResults.push({ archive, content, node });
  }
  scEmpty.style.display = 'none';
  scResults.style.display = 'flex';
  scRenderPage();
}

scLoadSaved();

// ── Add a result (called from progress handler) ───────────────────────────────

function scAddResult(archive, content) {
  const node = scBuildResultNode(archive, content);
  scAllResults.push({ archive, content, node });
  scSave();

  if (scResults.style.display === 'none') {
    scEmpty.style.display = 'none';
    scResults.style.display = 'flex';
  }

  // Stay on current page if it's not yet full; otherwise just update count/pagination
  const onLastPage = scPage === scTotalPages();
  if (onLastPage) scRenderPage();
  else scResultsCount.textContent = `${scAllResults.length} result${scAllResults.length !== 1 ? 's' : ''}`;
}

// ── Controls ──────────────────────────────────────────────────────────────────

scBtnPick.addEventListener('click', async () => {
  const folder = await window.api.pickFolder();
  if (!folder) return;
  scSelectedFolder = folder;
  scFolderPath.textContent = folder;
  scFolderPath.classList.add('has-path');
  scBtnScan.disabled = false;
  scSetStatus('');
});

scBtnScan.addEventListener('click', async () => {
  if (!scSelectedFolder || scScanning) return;
  scScanning = true;

  // Reset
  scAllResults = [];
  scPage = 1;
  window.api.scannerClearResults();
  scResultsList.innerHTML = '';
  scResults.style.display = 'none';
  scPagBar.style.display = 'none';
  scEmpty.style.display = 'block';
  scEmpty.textContent = 'Scanning…';
  scProgressWrap.style.display = 'flex';
  scSetProgress(0, 'Starting…');
  scBtnScan.style.display = 'none';
  scBtnCancel.style.display = '';
  scSetStatus('Walking folder…');

  await window.api.scannerScan(scSelectedFolder);
});

scBtnCancel.addEventListener('click', async () => {
  await window.api.scannerCancel();
  scSetStatus('Cancelling…');
});

scBtnCopyAll.addEventListener('click', () => {
  const text = scAllResults.map(r => `${r.content}\t${r.archive}`).join('\n');
  navigator.clipboard.writeText(text);
});

scBtnClear.addEventListener('click', async () => {
  if (scAllResults.length === 0) return;
  scAllResults = [];
  scPage = 1;
  scResultsList.innerHTML = '';
  scResults.style.display = 'none';
  scPagBar.style.display = 'none';
  scEmpty.style.display = 'block';
  scEmpty.textContent = 'Select a folder and click Scan to search for Unity packages and compressed archives.';
  scSetStatus('');
  await window.api.scannerClearResults();
});

// ── Progress events ───────────────────────────────────────────────────────────

window.api.onScannerProgress((data) => {
  switch (data.type) {
    case 'walking':
      scSetStatus('Walking folder…');
      break;

    case 'found_archives':
      scSetStatus(`Found ${data.count} archive${data.count !== 1 ? 's' : ''}`);
      scSetProgress(0, `0 / ${data.count}`);
      break;

    case 'scanning':
      scSetProgress(
        Math.round((data.index / data.total) * 100),
        `${data.index} / ${data.total}`
      );
      scSetStatus(data.current.split(/[\\/]/).pop());
      break;

    case 'result':
      scAddResult(data.archive, data.content);
      break;

    case 'archive_error':
      console.warn('[scanner] error on', data.archive, ':', data.message);
      break;

    case 'error':
      scSetStatus(data.message, 'error');
      scEmpty.textContent = data.message;
      scFinishScan();
      break;

    case 'cancelled':
      scSetStatus('Cancelled');
      scFinishScan();
      break;

    case 'done':
      scSetProgress(100, `${data.total} / ${data.total}`);
      scSetStatus(
        `Done — ${data.found} result${data.found !== 1 ? 's' : ''} in ${data.total} archive${data.total !== 1 ? 's' : ''}`,
        'done'
      );
      if (data.found === 0) scEmpty.textContent = 'No pathname files found in any archive.';
      scFinishScan();
      break;
  }
});

function scFinishScan() {
  scScanning = false;
  scBtnScan.style.display = '';
  scBtnCancel.style.display = 'none';
}
