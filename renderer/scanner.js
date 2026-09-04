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
const scBtnFindOrigins = document.getElementById('sc-btn-find-origins');
const scBtnPauseOrigins = document.getElementById('sc-btn-pause-origins');
const scOriginProgress = document.getElementById('sc-origin-progress');
const scResultSearch = document.getElementById('sc-result-search');
const scOriginFilter = document.getElementById('sc-origin-filter');

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

function scVisibleResults() {
  const search = scResultSearch.value.trim().toLowerCase();
  const filter = scOriginFilter.value;
  return scAllResults.filter(result => {
    const origin = result.origin || {};
    if (filter === 'high-confidence' && !(origin.candidates || []).some(candidate => candidate.confidence === 'exact' || candidate.confidence === 'high')) return false;
    if (filter === 'found' && origin.status !== 'found') return false;
    if (filter === 'selected' && !result.selectedOriginUrl) return false;
    if (filter === 'needs-review' && (origin.status === 'exact' || result.selectedOriginUrl)) return false;
    if (!search) return true;
    const candidateText = (origin.candidates || []).map(candidate => `${candidate.title || ''} ${candidate.shop || ''} ${candidate.itemId || ''}`).join(' ');
    return `${result.archive} ${result.content} ${origin.query || ''} ${candidateText}`.toLowerCase().includes(search);
  });
}

function scTotalPages() {
  return Math.max(1, Math.ceil(scVisibleResults().length / SC_PAGE_SIZE));
}

function scRenderPage(resetScroll = false) {
  const previousScroll = scResultsList.scrollTop;
  const visible = scVisibleResults();
  const total = visible.length;
  const pages = scTotalPages();
  scPage = Math.min(Math.max(1, scPage), pages);

  const start = (scPage - 1) * SC_PAGE_SIZE;
  const end   = Math.min(start + SC_PAGE_SIZE, total);

  scResultsList.innerHTML = '';
  for (let i = start; i < end; i++) {
    scResultsList.appendChild(visible[i].node);
  }
  scResultsList.scrollTop = resetScroll ? 0 : previousScroll;

  // Info
  scPagInfo.textContent = total === 0 ? '' : `${start + 1}–${end} of ${total}`;
  scResultsCount.textContent = total === scAllResults.length
    ? `${total} result${total !== 1 ? 's' : ''}`
    : `${total} of ${scAllResults.length} results`;

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
    btn.addEventListener('click', () => { scPage = p; scRenderPage(true); });
    scPagPages.appendChild(btn);
  }

  scBtnFirst.disabled = scPage <= 1;
  scBtnPrev.disabled  = scPage <= 1;
  scBtnNext.disabled  = scPage >= pages;
  scBtnLast.disabled  = scPage >= pages;

  scPagBar.style.display = pages > 1 ? 'flex' : 'none';
}

scBtnFirst.addEventListener('click', () => { scPage = 1;             scRenderPage(true); });
scBtnPrev .addEventListener('click', () => { scPage--;               scRenderPage(true); });
scBtnNext .addEventListener('click', () => { scPage++;               scRenderPage(true); });
scBtnLast .addEventListener('click', () => { scPage = scTotalPages(); scRenderPage(true); });
scResultSearch.addEventListener('input', () => { scPage = 1; scRenderPage(true); });
scOriginFilter.addEventListener('change', () => { scPage = 1; scRenderPage(true); });

// ── Build a result card (DOM only, not yet appended) ─────────────────────────

function scBuildResultNode(result) {
  const { archive, content } = result;
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
    <div class="sc-result-origin">
      <div class="sc-origin-summary"></div>
      <div class="sc-origin-candidates"></div>
    </div>
    <div class="sc-result-import-row">
      <input class="sc-result-url-input" type="url" placeholder="Confirmed BOOTH origin URL" autocomplete="off" spellcheck="false" />
      <button class="sc-result-import-btn btn-primary">+ Add to Library</button>
    </div>
  `;

  item.querySelector('.sc-result-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(archive);
  });

  const urlInput  = item.querySelector('.sc-result-url-input');
  const importBtn = item.querySelector('.sc-result-import-btn');
  urlInput.value = result.selectedOriginUrl || '';
  urlInput.addEventListener('change', () => {
    result.selectedOriginUrl = urlInput.value.trim();
    scSave();
  });
  scRenderOrigin(item, result);

  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    importBtn.textContent = '⏳ Importing…';

    const result = await window.api.scannerImportAsset({
      archivePath: archive,
      originUrl: urlInput.value.trim(),
    });

    if (result.ok) {
      if (await scRemoveResult(archive)) return;
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

function scRenderOriginState(state) {
  if (!state) return;
  scOriginProgress.textContent = state.total
    ? `${state.message} · ${state.processed}/${state.total}`
    : state.message;
  scBtnFindOrigins.textContent = state.paused ? '▶ Resume Origin Search' : '⌕ Find BOOTH Origins';
  scBtnPauseOrigins.style.display = state.running ? '' : 'none';
}

function scRenderOrigin(item, result) {
  const origin = result.origin || { status: 'ready', candidates: [] };
  const summary = item.querySelector('.sc-origin-summary');
  const candidatesWrap = item.querySelector('.sc-origin-candidates');
  const urlInput = item.querySelector('.sc-result-url-input');
  if (result.selectedOriginUrl && urlInput.value !== result.selectedOriginUrl) {
    urlInput.value = result.selectedOriginUrl;
  }
  const labels = {
    exact: 'Exact local match', ready: 'Ready for BOOTH search', searching: 'Searching BOOTH',
    waiting: 'Waiting for BOOTH', found: 'Candidates found', 'not-found': 'No candidate', error: 'Search error',
  };
  summary.innerHTML = '';
  candidatesWrap.innerHTML = '';

  const automaticCandidate = (origin.candidates || []).find(candidate => candidate.confidence === 'exact' || candidate.confidence === 'high');
  item.classList.toggle('sc-result-item--high-confidence', Boolean(automaticCandidate));
  if (['exact', 'found'].includes(origin.status) && !result.selectedOriginUrl && automaticCandidate) {
    result.selectedOriginUrl = automaticCandidate.url;
    urlInput.value = result.selectedOriginUrl;
  }

  const badge = document.createElement('span');
  badge.className = `sc-origin-badge sc-origin-badge--${origin.status || 'ready'}`;
  badge.textContent = labels[origin.status] || 'Origin Finder';
  summary.appendChild(badge);

  const detail = document.createElement('span');
  detail.className = 'sc-origin-detail';
  detail.textContent = origin.message || (origin.query ? `Query: ${origin.query}` : 'Local metadata will be checked first');
  summary.appendChild(detail);

  const searchButton = document.createElement('button');
  searchButton.className = 'btn-ghost sc-origin-search-one';
  searchButton.textContent = 'Search this item';
  searchButton.disabled = ['searching', 'waiting'].includes(origin.status);
  searchButton.addEventListener('click', async () => {
    searchButton.disabled = true;
    try {
      scRenderOriginState(await window.api.originFinderSearchOne(result.archive));
    } finally {
      if (!['searching', 'waiting'].includes(result.origin?.status)) searchButton.disabled = false;
    }
  });
  summary.appendChild(searchButton);

  for (const candidate of (origin.candidates || []).slice(0, 3)) {
    const row = document.createElement('div');
    const highConfidence = candidate.confidence === 'exact' || candidate.confidence === 'high';
    row.className = `sc-origin-candidate${highConfidence ? ' sc-origin-candidate--high-confidence' : ''}`;
    const info = document.createElement('div');
    info.className = 'sc-origin-candidate-info';
    const title = document.createElement('span');
    title.className = 'sc-origin-candidate-title';
    title.textContent = candidate.title || `BOOTH item #${candidate.itemId}`;
    const meta = document.createElement('span');
    meta.className = 'sc-origin-candidate-meta';
    meta.textContent = [candidate.shop, candidate.confidence && `${candidate.confidence} confidence`, candidate.reason].filter(Boolean).join(' · ');
    info.append(title, meta);

    const useButton = document.createElement('button');
    useButton.className = 'btn-secondary sc-origin-use';
    useButton.textContent = result.selectedOriginUrl === candidate.url ? '✓ Selected' : 'Use';
    useButton.addEventListener('click', () => {
      result.selectedOriginUrl = candidate.url;
      urlInput.value = candidate.url;
      scSave();
      scRenderOrigin(item, result);
      scRenderPage();
    });
    const openButton = document.createElement('button');
    openButton.className = 'btn-ghost sc-origin-open';
    openButton.textContent = 'Open';
    openButton.addEventListener('click', () => window.api.openExternal(candidate.url));
    row.append(info, useButton, openButton);
    candidatesWrap.appendChild(row);
  }
}

// ── Persistence ───────────────────────────────────────────────────────────────

function scSave() {
  return window.api.scannerSaveResults(scAllResults.map(r => ({
    archive: r.archive,
    content: r.content,
    pathnames: r.pathnames,
    originEvidence: r.originEvidence,
    origin: r.origin,
    selectedOriginUrl: r.selectedOriginUrl,
  })));
}

async function scRemoveResult(archive) {
  const previousLength = scAllResults.length;
  scAllResults = scAllResults.filter(result => result.archive !== archive);
  if (scAllResults.length === previousLength) return false;

  await scSave();
  scRenderPage();
  if (scAllResults.length === 0) {
    scResults.style.display = 'none';
    scPagBar.style.display = 'none';
    scEmpty.style.display = 'block';
    scEmpty.textContent = 'No saved scan results remain.';
  }
  return true;
}

async function scLoadSaved() {
  const saved = await window.api.scannerGetResults();
  if (!saved || saved.length === 0) return;
  for (const savedResult of saved) {
    const result = { ...savedResult };
    result.node = scBuildResultNode(result);
    scAllResults.push(result);
  }
  scEmpty.style.display = 'none';
  scResults.style.display = 'flex';
  scRenderPage();
}

scLoadSaved();

async function scLoadFolder() {
  const folder = await window.api.scannerGetFolder();
  if (!folder) return;
  scSelectedFolder = folder;
  scFolderPath.textContent = folder;
  scFolderPath.classList.add('has-path');
  scBtnScan.disabled = false;
}

scLoadFolder();

// ── Add a result (called from progress handler) ───────────────────────────────

function scAddResult(data) {
  const result = {
    archive: data.archive,
    content: data.content,
    pathnames: data.pathnames,
    originEvidence: data.originEvidence,
    origin: data.origin,
  };
  result.node = scBuildResultNode(result);
  scAllResults.push(result);
  scSave();

  if (scResults.style.display === 'none') {
    scEmpty.style.display = 'none';
    scResults.style.display = 'flex';
  }

  // Stay on current page if it's not yet full; otherwise just update count/pagination
  scRenderPage();
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

scBtnFindOrigins.addEventListener('click', async () => {
  scBtnFindOrigins.disabled = true;
  try {
    scRenderOriginState(await window.api.originFinderStart());
  } finally {
    scBtnFindOrigins.disabled = false;
  }
});

scBtnPauseOrigins.addEventListener('click', async () => {
  scRenderOriginState(await window.api.originFinderPause());
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
      scAddResult(data);
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
      if (data.found === 0) scEmpty.textContent = 'No Unity packages were found in the selected folder or its compressed files.';
      scFinishScan();
      break;
  }
});

function scFinishScan() {
  scScanning = false;
  scBtnScan.style.display = '';
  scBtnCancel.style.display = 'none';
}

window.api.onOriginFinderUpdate(data => {
  if (data.state) scRenderOriginState(data.state);
  if (data.type !== 'result') return;
  const result = scAllResults.find(item => item.archive === data.archive);
  if (!result) return;
  result.origin = data.origin;
  if (data.selectedOriginUrl && !result.selectedOriginUrl) result.selectedOriginUrl = data.selectedOriginUrl;
  scRenderOrigin(result.node, result);
  scRenderPage();
});

window.api.originFinderState().then(scRenderOriginState);
