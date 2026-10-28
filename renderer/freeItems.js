// ── Booth Free Items tab ──────────────────────────────────────────────────────

const fiStatus        = document.getElementById('fi-status');
const fiBtnSettings   = document.getElementById('fi-btn-settings');
const fiBtnScan       = document.getElementById('fi-btn-scan');
const fiSettingsPanel = document.getElementById('fi-settings-panel');
const fiBtnSave       = document.getElementById('fi-btn-save-settings');
const fiBtnCancel     = document.getElementById('fi-btn-cancel-settings');
const fiInterval      = document.getElementById('fi-interval');
const fiMaxPages      = document.getElementById('fi-max-pages');
const fiEmpty         = document.getElementById('fi-empty');
const fiList          = document.getElementById('fi-items-list');
const fiPagBar        = document.getElementById('fi-pagination-bar');
const fiPagInfo       = document.getElementById('fi-pag-info');
const fiPagPages      = document.getElementById('fi-pag-pages');
const fiToggle        = document.getElementById('fi-toggle');
const fiBtnView       = document.getElementById('fi-btn-view');

const FI_PAGE_SIZE = 20;
let fiViewMode = localStorage.getItem('fiViewMode') || 'list'; // 'list' | 'grid'

function applyFiViewMode() {
  fiList.classList.toggle('fi-view-grid', fiViewMode === 'grid');
  fiBtnView.textContent = fiViewMode === 'grid' ? '▤ List' : '⊞ Grid';
}

fiBtnView.addEventListener('click', () => {
  fiViewMode = fiViewMode === 'grid' ? 'list' : 'grid';
  localStorage.setItem('fiViewMode', fiViewMode);
  applyFiViewMode();
});

let scanning        = false;
let allItems        = [];   // full list (all found items)
let fiPage          = 1;
let libraryItemIds  = new Set();  // booth item IDs already in the BBLM library
let fiLocked        = false;      // web mode without the access token

function fiTokenError(err) {
  return Boolean(err && (err.tokenRequired === true || err.status === 401));
}

// The Free Items tab reads saved lists and changes settings, so the web server
// asks for the access token. Without it, show a lock notice instead of an
// empty list and hide the buttons that would fail.
function showFiLockNotice() {
  fiLocked = true;
  const panel = document.getElementById('tab-free-items');
  if (panel) panel.classList.add('fi-locked');
  let notice = document.getElementById('fi-lock-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'fi-lock-notice';
    notice.className = 'fi-empty fi-lock-notice';
    const text = document.createElement('p');
    text.textContent = 'The Booth Free Items tab needs the access token. The library view stays open. Read the token in Settings → Integrations → Remote Access.';
    notice.appendChild(text);
    if (typeof window.api.requestUnlock === 'function') {
      const button = document.createElement('button');
      button.className = 'btn-primary';
      button.textContent = '🔒 Unlock';
      button.addEventListener('click', () => window.api.requestUnlock());
      notice.appendChild(button);
    }
    fiList.before(notice);
  }
  notice.style.display = '';
  fiList.style.display = 'none';
  fiEmpty.style.display = 'none';
  fiPagBar.style.display = 'none';
  scanning = false;
  fiBtnScan.textContent = '▶ Scan Now';
  setStatus('Locked — enter the access token.', 'error');
}

function escHtmlFi(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Toggle enabled/disabled ──
function applyEnabledState(enabled) {
  fiToggle.textContent = enabled ? 'On' : 'Off';
  fiToggle.setAttribute('aria-checked', enabled);
  fiToggle.classList.toggle('fi-toggle-off', !enabled);
  document.querySelectorAll('.fi-enabled-only').forEach(el => {
    el.style.display = enabled ? '' : 'none';
  });
  // Show a disabled notice or the normal content
  let notice = document.getElementById('fi-disabled-notice');
  if (!enabled) {
    fiSettingsPanel.style.display = 'none';
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'fi-disabled-notice';
      notice.className = 'fi-empty';
      notice.textContent = 'Booth Free Items scanning is disabled.';
      fiList.before(notice);
    }
    fiEmpty.style.display = 'none';
    fiPagBar.style.display = 'none';
    fiList.style.display = 'none';
    if (scanning) fiBtnScan.click(); // stop any running scan
  } else {
    if (notice) notice.remove();
    fiList.style.display = '';
    renderFiPage();
  }
}

fiToggle.addEventListener('click', async () => {
  const nowEnabled = fiToggle.getAttribute('aria-checked') !== 'true';
  try {
    await window.api.setFreeItemsConfig({
      enabled: nowEnabled,
      interval: parseInt(fiInterval.value, 10) || 0,
      maxPages: parseInt(fiMaxPages.value, 10) || 5,
    });
  } catch (err) {
    if (fiTokenError(err)) showFiLockNotice();
    else setStatus(`Error: ${err.message}`, 'error');
    return;
  }
  applyEnabledState(nowEnabled);
});

// ── Load config ──
async function loadFiConfig() {
  const cfg = await window.api.getFreeItemsConfig();
  fiInterval.value = String(cfg.interval || 6);
  fiMaxPages.value = cfg.maxPages || 5;
  applyEnabledState(cfg.enabled !== false); // default on
}

// ── Save config ──
fiBtnSave.addEventListener('click', async () => {
  try {
    await window.api.setFreeItemsConfig({
      enabled: fiToggle.getAttribute('aria-checked') === 'true',
      interval: parseInt(fiInterval.value, 10) || 0,
      maxPages: parseInt(fiMaxPages.value, 10) || 5,
    });
  } catch (err) {
    if (fiTokenError(err)) { showFiLockNotice(); return; }
    setStatus(`Error: ${err.message}`, 'error');
    return;
  }
  fiSettingsPanel.style.display = 'none';
  setStatus('Settings saved', 'done');
  setTimeout(() => setStatus('Ready'), 2000);
});

fiBtnCancel.addEventListener('click', () => {
  fiSettingsPanel.style.display = 'none';
});

fiBtnSettings.addEventListener('click', () => {
  const open = fiSettingsPanel.style.display !== 'none';
  fiSettingsPanel.style.display = open ? 'none' : 'block';
  if (!open) loadFiConfig();
});

// ── Status helper ──
function setStatus(text, cls = '') {
  fiStatus.textContent = text;
  fiStatus.className = 'fi-status' + (cls ? ' ' + cls : '');
}

// ── Pagination ──
// Returns the page window for the current item count and keeps fiPage in range.
function computeFiPage() {
  const total    = allItems.length;
  const lastPage = Math.max(1, Math.ceil(total / FI_PAGE_SIZE));
  fiPage         = Math.min(Math.max(1, fiPage), lastPage);
  const start    = (fiPage - 1) * FI_PAGE_SIZE;
  const end      = Math.min(start + FI_PAGE_SIZE, total);
  return { total, lastPage, start, end };
}

// Rebuild only the pagination bar, so callers can add a row without a full
// re-render (a full re-render resets in-progress download buttons).
function renderFiPagination() {
  const { total, lastPage, start, end } = computeFiPage();

  fiPagBar.style.display = total > FI_PAGE_SIZE ? 'flex' : 'none';

  // Pagination info
  fiPagInfo.textContent = total > 0 ? `${start + 1}–${end} of ${total}` : '';

  // Page buttons
  fiPagPages.innerHTML = '';
  const visible = new Set([1, lastPage]);
  for (let i = Math.max(1, fiPage - 1); i <= Math.min(lastPage, fiPage + 1); i++) visible.add(i);
  let prev = 0;
  [...visible].sort((a, b) => a - b).forEach(p => {
    if (p - prev > 1) {
      const dots = document.createElement('span');
      dots.className = 'pag-ellipsis';
      dots.textContent = '…';
      fiPagPages.appendChild(dots);
    }
    const btn = document.createElement('button');
    btn.className = 'pag-page-btn' + (p === fiPage ? ' active' : '');
    btn.textContent = p;
    btn.addEventListener('click', () => { fiPage = p; renderFiPage(); });
    fiPagPages.appendChild(btn);
    prev = p;
  });

  document.getElementById('fi-btn-first').disabled = fiPage === 1;
  document.getElementById('fi-btn-prev').disabled  = fiPage === 1;
  document.getElementById('fi-btn-next').disabled  = fiPage === lastPage;
  document.getElementById('fi-btn-last').disabled  = fiPage === lastPage;
}

function renderFiPage() {
  const { total, start } = computeFiPage();
  const pageItems = allItems.slice(start, start + FI_PAGE_SIZE);

  fiList.innerHTML = '';
  fiEmpty.style.display = total === 0 ? 'block' : 'none';

  for (const item of pageItems) fiList.appendChild(buildRow(item));

  renderFiPagination();
}

document.getElementById('fi-btn-first').addEventListener('click', () => { fiPage = 1; renderFiPage(); });
document.getElementById('fi-btn-prev').addEventListener('click',  () => { fiPage--; renderFiPage(); });
document.getElementById('fi-btn-next').addEventListener('click',  () => { fiPage++; renderFiPage(); });
document.getElementById('fi-btn-last').addEventListener('click',  () => {
  fiPage = Math.ceil(allItems.length / FI_PAGE_SIZE);
  renderFiPage();
});

// Web mode: the browser asks the desktop app to download the item. Follow the
// request so the row shows the real state instead of only "Queued".
function followWebDownload(dlBtn, item, requestId) {
  let ticks = 0;
  let failures = 0;
  const timer = setInterval(async () => {
    ticks += 1;
    if (ticks > 150) { clearInterval(timer); dlBtn.textContent = '✔ Queued'; return; }
    let request;
    try {
      const data = await window.api.webDownloadStatus(requestId);
      request = data && data.request;
    } catch {
      failures += 1;
      if (failures > 3) { clearInterval(timer); dlBtn.textContent = '✔ Queued'; }
      return;
    }
    if (!request) return;
    if (request.state === 'resolving' || request.state === 'queued') {
      dlBtn.textContent = '✔ Queued';
    } else if (request.state === 'downloading') {
      dlBtn.textContent = `⬇ ${request.percent || 0}%`;
    } else if (request.state === 'done') {
      clearInterval(timer);
      dlBtn.textContent = '✔ Downloaded';
      libraryItemIds.add(item.itemId);
    } else if (request.state === 'error') {
      clearInterval(timer);
      dlBtn.disabled = false;
      dlBtn.textContent = '⬇ Download';
      setStatus(`Error: ${request.error || 'Download failed'}`, 'error');
      setTimeout(() => setStatus('Ready'), 6000);
    }
  }, 2000);
}

// ── Build a list row ──
function buildRow(item) {
  const boothUrl  = item.boothUrl || `https://booth.pm/en/items/${item.itemId}`;
  const inLibrary = libraryItemIds.has(item.itemId);

  const row = document.createElement('div');
  row.className = 'fi-row';
  row.dataset.itemId = item.itemId;

  const thumbHtml = item.thumbnailUrl
    ? `<img class="fi-row-thumb" src="${escHtmlFi(item.thumbnailUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="fi-row-thumb-ph" style="display:none">📦</div>`
    : `<div class="fi-row-thumb-ph">📦</div>`;

  let dlBtnHtml = '';
  if (item.deeplinkUrl) {
    if (inLibrary) {
      dlBtnHtml = `<button class="fi-btn-download fi-btn-in-library" disabled title="Already in your library">✔ In Library</button>`;
    } else {
      dlBtnHtml = `<button class="fi-btn-download" data-url="${escHtmlFi(item.deeplinkUrl)}">⬇ Download</button>`;
    }
  }

  row.innerHTML = `
    <div class="fi-row-thumb-wrap">${thumbHtml}</div>
    <div class="fi-row-info">
      <div class="fi-row-name" title="${escHtmlFi(item.name)}">${escHtmlFi(item.name)}</div>
      <div class="fi-row-price">${item.priceRange ? escHtmlFi(item.priceRange) : '¥0'}</div>
    </div>
    <div class="fi-row-actions">${dlBtnHtml}</div>`;

  row.addEventListener('click', () => window.api.openExternal(boothUrl));

  if (item.deeplinkUrl && !inLibrary) {
    const dlBtn = row.querySelector('.fi-btn-download');
    dlBtn.addEventListener('click', async e => {
      e.stopPropagation();
      dlBtn.disabled = true;
      dlBtn.textContent = '…';
      console.log('[free-items] downloading', { itemId: item.itemId, name: item.name, deeplinkUrl: dlBtn.dataset.url });
      let result;
      try {
        result = await window.api.downloadFreeItem(dlBtn.dataset.url);
      } catch (err) {
        result = { ok: false, error: err.message, tokenRequired: err.tokenRequired === true };
      }
      console.log('[free-items] download result', result);
      if (result && result.ok) {
        dlBtn.textContent = '✔ Queued';
        // Mark as in library so re-render doesn't reset it
        libraryItemIds.add(item.itemId);
        if (window.__BBLM_WEB__ && result.request && typeof window.api.webDownloadStatus === 'function') {
          followWebDownload(dlBtn, item, result.request.id);
        }
      } else {
        dlBtn.disabled = false;
        dlBtn.textContent = '⬇ Download';
        const msg = result && result.error ? result.error : 'Download failed';
        setStatus(`Error: ${msg}`, 'error');
        setTimeout(() => setStatus('Ready'), 6000);
        if (result && result.tokenRequired && typeof window.api.requestUnlock === 'function') {
          window.api.requestUnlock();
        }
      }
    });
  }

  return row;
}

// ── Scan ──
fiBtnScan.addEventListener('click', async () => {
  if (scanning) {
    await window.api.stopFreeScan();
    fiBtnScan.textContent = '▶ Scan Now';
    scanning = false;
    setStatus('Scan stopped');
    return;
  }
  allItems = [];
  fiPage   = 1;
  renderFiPage();

  scanning = true;
  fiBtnScan.textContent = '■ Stop';
  setStatus('Starting scan…', 'scanning');
  try {
    await window.api.startFreeScan();
  } catch (err) {
    scanning = false;
    fiBtnScan.textContent = '▶ Scan Now';
    if (fiTokenError(err)) { showFiLockNotice(); return; }
    setStatus(`Error: ${err.message}`, 'error');
  }
});

// ── Progress updates ──
window.api.onFreeItemsProgress(({ phase, page, maxPages, itemId, scannedCount, foundCount, message }) => {
  if (phase === 'started') {
    setStatus('Scan started…', 'scanning');
  } else if (phase === 'fetching-page') {
    setStatus(`Fetching page ${page}/${maxPages}…`, 'scanning');
  } else if (phase === 'checking-item') {
    setStatus(`Page ${page}/${maxPages} — checked ${scannedCount}, found ${foundCount} free`, 'scanning');
  } else if (phase === 'found-item') {
    setStatus(`Found free item ${itemId}! (${foundCount} total)`, 'scanning');
  } else if (phase === 'done') {
    scanning = false;
    fiBtnScan.textContent = '▶ Scan Now';
    setStatus(`Done — ${scannedCount} scanned, ${foundCount} free items found`, 'done');
    setTimeout(() => setStatus('Ready'), 8000);
  } else if (phase === 'error') {
    scanning = false;
    fiBtnScan.textContent = '▶ Scan Now';
    setStatus(`Error: ${message}`, 'error');
  }
});

// ── New item found during scan ──
window.api.onFreeItemFound(item => {
  if (allItems.find(i => i.itemId === item.itemId)) return;
  allItems.push(item);

  const { total } = computeFiPage();
  const itemPage = Math.ceil(total / FI_PAGE_SIZE);

  if (fiPage === itemPage) {
    // The new item belongs to the page on screen: append it and keep the
    // existing rows (and their download button state) untouched.
    fiList.appendChild(buildRow(item));
    fiEmpty.style.display = 'none';
  }
  // Always rebuild the pagination bar so the count, page buttons and the
  // last-page state follow the new total.
  renderFiPagination();
});

// ── Load persisted items on init ──
async function loadFoundFreeItems() {
  const [items, ids] = await Promise.all([
    window.api.getFoundFreeItems(),
    window.api.getLibraryItemIds(),
  ]);
  libraryItemIds = new Set(ids);
  allItems = items;
  fiPage   = 1;
  renderFiPage();
}

// Web mode without the token: the reads answer 401, so show the lock notice.
async function initFreeItems() {
  if (fiLocked) return;
  try {
    await loadFiConfig();
    await loadFoundFreeItems();
  } catch (err) {
    if (fiTokenError(err)) showFiLockNotice();
    else console.warn('[free-items] init failed:', err.message);
  }
}

// Refresh library IDs whenever the user switches to this tab (new downloads may have landed)
document.querySelector('.tab-btn[data-tab="free-items"]').addEventListener('click', async () => {
  if (fiLocked) return;
  try {
    const ids = await window.api.getLibraryItemIds();
    const prev = libraryItemIds;
    libraryItemIds = new Set(ids);
    if (ids.some(id => !prev.has(id)) || prev.size !== ids.length) renderFiPage();
  } catch (err) {
    if (fiTokenError(err)) showFiLockNotice();
  }
});

// Refresh in-library state whenever any download completes
window.api.onDownloadProgress(({ done }) => {
  if (!done) return;
  window.api.getLibraryItemIds().then(ids => {
    const prev = libraryItemIds;
    libraryItemIds = new Set(ids);
    if (ids.some(id => !prev.has(id)) || prev.size !== ids.length) renderFiPage();
  });
});

applyFiViewMode();
initFreeItems();
