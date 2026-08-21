const grid = document.getElementById('asset-grid');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search');
const btnSort = document.getElementById('btn-sort');
const btnView = document.getElementById('btn-view');
const btnAddAsset = document.getElementById('btn-add-asset');
const btnAdultFilter = document.getElementById('btn-adult-filter');

// ── Pagination state ─────────────────────────────────────────────────────────
const PAGE_SIZES = [10, 30, 50];
let pageSize    = parseInt(localStorage.getItem('pageSize') || '30');
let currentPage = 1;

function initPagination() {
  document.querySelectorAll('.pag-size-btn').forEach(btn => {
    const size = parseInt(btn.dataset.size);
    btn.classList.toggle('active', size === pageSize);
    btn.addEventListener('click', () => {
      pageSize = size;
      currentPage = 1;
      localStorage.setItem('pageSize', pageSize);
      document.querySelectorAll('.pag-size-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.size) === pageSize));
      loadLibrary(searchInput.value);
      document.getElementById('library').scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  document.getElementById('btn-first').addEventListener('click', () => goToPage(1));
  document.getElementById('btn-prev').addEventListener('click',  () => goToPage(currentPage - 1));
  document.getElementById('btn-next').addEventListener('click',  () => goToPage(currentPage + 1));
  document.getElementById('btn-last').addEventListener('click',  () => goToPage(lastPage));
}

let lastPage = 1;
function goToPage(p) {
  currentPage = Math.max(1, Math.min(p, lastPage));
  loadLibrary(searchInput.value);
  document.getElementById('library').scrollTo({ top: 0, behavior: 'smooth' });
}

function renderPagination(totalFiltered) {
  lastPage = Math.max(1, Math.ceil(totalFiltered / pageSize));
  currentPage = Math.min(currentPage, lastPage);

  const start = (currentPage - 1) * pageSize + 1;
  const end   = Math.min(currentPage * pageSize, totalFiltered);
  document.getElementById('pagination-info').textContent =
    totalFiltered === 0 ? '' : `${start}–${end} of ${totalFiltered}`;

  document.getElementById('btn-first').disabled = currentPage === 1;
  document.getElementById('btn-prev').disabled  = currentPage === 1;
  document.getElementById('btn-next').disabled  = currentPage === lastPage;
  document.getElementById('btn-last').disabled  = currentPage === lastPage;

  // Page number buttons: always show first, last, current ±1, with ellipsis
  const pages = document.getElementById('pag-pages');
  pages.innerHTML = '';
  if (lastPage <= 1) return;

  const visiblePages = new Set();
  visiblePages.add(1);
  visiblePages.add(lastPage);
  for (let i = Math.max(1, currentPage - 1); i <= Math.min(lastPage, currentPage + 1); i++) visiblePages.add(i);

  const sorted = [...visiblePages].sort((a, b) => a - b);
  let prev = 0;
  sorted.forEach(p => {
    if (p - prev > 1) {
      const dots = document.createElement('span');
      dots.className = 'pag-ellipsis';
      dots.textContent = '…';
      pages.appendChild(dots);
    }
    const btn = document.createElement('button');
    btn.className = 'pag-page-btn' + (p === currentPage ? ' active' : '');
    btn.textContent = p;
    btn.addEventListener('click', () => goToPage(p));
    pages.appendChild(btn);
    prev = p;
  });
}
const tagFilterBar   = document.getElementById('tag-filter-bar');
const tagFilterChips = document.getElementById('tag-filter-chips');
const btnFilter      = document.getElementById('btn-filter');
const filterDropdown = document.getElementById('filter-dropdown');
const filterTagSearch = document.getElementById('filter-tag-search');
const filterTagList  = document.getElementById('filter-tag-list');

let activeTagFilters = new Set(); // multi-tag filter
let allTagCounts = {};            // tag → count across all assets (populated in loadLibrary)

const THREAT_LEVELS = [
  { key: 'critical',  label: 'Critical' },
  { key: 'high',       label: 'High' },
  { key: 'medium',     label: 'Medium' },
  { key: 'low',        label: 'Low' },
  { key: 'clean',      label: 'Clean' },
  { key: 'error',      label: 'Scan error' },
  { key: 'untested',   label: 'Not scanned' },
];
const THREAT_LABELS = Object.fromEntries(THREAT_LEVELS.map(t => [t.key, t.label]));

const btnThreatFilter      = document.getElementById('btn-threat-filter');
const threatFilterDropdown = document.getElementById('threat-filter-dropdown');
const threatFilterList     = document.getElementById('threat-filter-list');

let activeThreatFilters = new Set(); // multi-select threat level filter
let allThreatCounts = {};            // threat level → count across all assets (populated in loadLibrary)

// ── Toggle dropdown ──
btnFilter.addEventListener('click', e => {
  e.stopPropagation();
  const open = filterDropdown.style.display !== 'none';
  filterDropdown.style.display = open ? 'none' : 'flex';
  if (!open) {
    filterTagSearch.value = '';
    renderFilterTagList('');
    filterTagSearch.focus();
  }
});

document.addEventListener('click', e => {
  if (!filterDropdown.contains(e.target) && e.target !== btnFilter) {
    filterDropdown.style.display = 'none';
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') filterDropdown.style.display = 'none';
});

filterTagSearch.addEventListener('input', () => renderFilterTagList(filterTagSearch.value));

function renderFilterTagList(search) {
  const q = search.trim().toLowerCase();
  const tags = Object.keys(allTagCounts).sort((a, b) => {
    // Active tags first, then by count desc, then alpha
    const aActive = activeTagFilters.has(a), bActive = activeTagFilters.has(b);
    if (aActive !== bActive) return aActive ? -1 : 1;
    return (allTagCounts[b] - allTagCounts[a]) || a.localeCompare(b);
  });
  const filtered = q ? tags.filter(t => t.toLowerCase().includes(q)) : tags;

  filterTagList.innerHTML = '';
  if (filtered.length === 0) {
    filterTagList.innerHTML = `<div class="filter-tag-empty">No tags found</div>`;
    return;
  }
  filtered.forEach(tag => {
    const item = document.createElement('div');
    item.className = 'filter-tag-item' + (activeTagFilters.has(tag) ? ' active' : '');
    item.innerHTML = `<span>${escHtml(tag)}</span><span class="tag-count">${allTagCounts[tag]}</span>`;
    item.addEventListener('click', () => toggleTagFilter(tag));
    filterTagList.appendChild(item);
  });
}

function toggleTagFilter(tag) {
  if (activeTagFilters.has(tag)) {
    activeTagFilters.delete(tag);
  } else {
    activeTagFilters.add(tag);
  }
  currentPage = 1;
  updateFilterBar();
  renderFilterTagList(filterTagSearch.value);
  loadLibrary(searchInput.value);
}

function updateFilterBar() {
  const activeTags = [...activeTagFilters];
  const activeThreats = [...activeThreatFilters];
  tagFilterBar.style.display = (activeTags.length || activeThreats.length) ? 'flex' : 'none';
  const tagChips = activeTags
    .map(t => `<span class="tag-pill tag-pill--active" data-tag="${escHtml(t)}">${escHtml(t)}<button class="tag-pill-remove" style="background:none;border:none;color:inherit;cursor:pointer;font-size:11px;padding:0 0 0 3px;">×</button></span>`)
    .join('');
  const threatChips = activeThreats
    .map(t => `<span class="tag-pill tag-pill--active" data-threat="${escHtml(t)}">⚠ ${escHtml(THREAT_LABELS[t] || t)}<button class="tag-pill-remove" style="background:none;border:none;color:inherit;cursor:pointer;font-size:11px;padding:0 0 0 3px;">×</button></span>`)
    .join('');
  tagFilterChips.innerHTML = tagChips + threatChips;
  tagFilterChips.querySelectorAll('.tag-pill-remove').forEach(btn => {
    const pill = btn.parentElement;
    if (pill.dataset.tag !== undefined) btn.addEventListener('click', () => toggleTagFilter(pill.dataset.tag));
    else btn.addEventListener('click', () => toggleThreatFilter(pill.dataset.threat));
  });
  // Update filter button styles
  btnFilter.classList.toggle('btn-filter--active', activeTags.length > 0);
  btnFilter.textContent = activeTags.length ? `⌖ Tags (${activeTags.length})` : '⌖ Tags';
  btnThreatFilter.classList.toggle('btn-filter--active', activeThreats.length > 0);
  btnThreatFilter.textContent = activeThreats.length ? `⚠ Threat (${activeThreats.length})` : '⚠ Threat';
}

// Legacy single-tag click from card pills
function setTagFilter(tag) {
  if (!activeTagFilters.has(tag)) {
    activeTagFilters.add(tag);
    updateFilterBar();
    loadLibrary(searchInput.value);
  }
}

document.getElementById('btn-clear-tag-filter').addEventListener('click', () => {
  activeTagFilters.clear();
  activeThreatFilters.clear();
  updateFilterBar();
  loadLibrary(searchInput.value);
});

// ── Threat level filter ──
btnThreatFilter.addEventListener('click', e => {
  e.stopPropagation();
  const open = threatFilterDropdown.style.display !== 'none';
  threatFilterDropdown.style.display = open ? 'none' : 'flex';
  if (!open) renderThreatFilterList();
});

document.addEventListener('click', e => {
  if (!threatFilterDropdown.contains(e.target) && e.target !== btnThreatFilter) {
    threatFilterDropdown.style.display = 'none';
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') threatFilterDropdown.style.display = 'none';
});

function renderThreatFilterList() {
  threatFilterList.innerHTML = '';
  THREAT_LEVELS.forEach(({ key, label }) => {
    const count = allThreatCounts[key] || 0;
    const item = document.createElement('div');
    item.className = 'filter-tag-item' + (activeThreatFilters.has(key) ? ' active' : '');
    item.innerHTML = `<span>${escHtml(label)}</span><span class="tag-count">${count}</span>`;
    item.addEventListener('click', () => toggleThreatFilter(key));
    threatFilterList.appendChild(item);
  });
}

function toggleThreatFilter(key) {
  if (activeThreatFilters.has(key)) {
    activeThreatFilters.delete(key);
  } else {
    activeThreatFilters.add(key);
  }
  currentPage = 1;
  updateFilterBar();
  renderThreatFilterList();
  loadLibrary(searchInput.value);
}

// Footer external link
document.querySelector('.footer-link').addEventListener('click', e => {
  e.preventDefault();
  window.api.openExternal('https://github.com/BunBnnuy/BBLM');
});

let sortMode = localStorage.getItem('sortMode') || 'date'; // 'date' | 'alpha'

// view modes: 'grid' | 'list' | 'list-compact'
const VIEW_MODES = ['grid', 'list', 'list-compact'];
const VIEW_LABELS = { grid: '⊞ Grid', list: '▤ List', 'list-compact': '≡ Compact' };
let viewMode = localStorage.getItem('viewMode') || 'grid';

function applyViewMode() {
  grid.classList.remove('view-list', 'view-list-compact');
  if (viewMode === 'list') grid.classList.add('view-list');
  if (viewMode === 'list-compact') grid.classList.add('view-list-compact');
  btnView.textContent = VIEW_LABELS[viewMode];
}

btnView.addEventListener('click', () => {
  const idx = VIEW_MODES.indexOf(viewMode);
  viewMode = VIEW_MODES[(idx + 1) % VIEW_MODES.length];
  localStorage.setItem('viewMode', viewMode);
  applyViewMode();
});

function updateSortButton() {
  btnSort.textContent = sortMode === 'date' ? '⇅ Date' : '⇅ A–Z';
}

// adult content filter: 'all' (show everything) | 'hide' (hide adult) | 'only' (adult only)
const ADULT_FILTER_MODES = ['all', 'hide', 'only'];
const ADULT_FILTER_LABELS = { all: '🔞 Show All', hide: '🔞 Hide Adult', only: '🔞 Adult Only' };
let adultFilterMode = localStorage.getItem('adultFilterMode') || 'all';

function updateAdultFilterButton() {
  btnAdultFilter.textContent = ADULT_FILTER_LABELS[adultFilterMode];
  btnAdultFilter.classList.toggle('btn-filter--active', adultFilterMode !== 'all');
}

btnAdultFilter.addEventListener('click', () => {
  const idx = ADULT_FILTER_MODES.indexOf(adultFilterMode);
  adultFilterMode = ADULT_FILTER_MODES[(idx + 1) % ADULT_FILTER_MODES.length];
  localStorage.setItem('adultFilterMode', adultFilterMode);
  updateAdultFilterButton();
  currentPage = 1;
  loadLibrary(searchInput.value);
});

btnSort.addEventListener('click', () => {
  sortMode = sortMode === 'date' ? 'alpha' : 'date';
  localStorage.setItem('sortMode', sortMode);
  updateSortButton();
  loadLibrary(searchInput.value);
});

btnAddAsset.addEventListener('click', () => {
  window.api.pickFiles().then(paths => {
    if (!paths || paths.length === 0) return;
    window.api.openImportModal(paths.length === 1 ? paths[0] : { filePaths: paths });
  });
});

// ── Drag & drop — two-zone system ────────────────────────────────────────────
const dropOverlay     = document.getElementById('drop-overlay');
const dropZoneNew     = document.getElementById('drop-zone-new');
const dropZoneExist   = document.getElementById('drop-zone-existing');
const dropZoneTimer   = document.getElementById('drop-zone-timer');

let dragCounter      = 0;
let existHoverTimer  = null;   // 500ms timer
let existTimerRAF    = null;   // animation frame for conic fill
let existTimerStart  = null;
let addToExistMode   = false;  // true after 500ms hover on right box
let existModeTimeout = null;   // failsafe: auto-close overlay if drag is cancelled outside the window
const EXIST_DELAY    = 500;
const EXIST_MODE_TIMEOUT = 10000;

function resetDragState() {
  dragCounter = 0;
  addToExistMode = false;
  if (existModeTimeout) { clearTimeout(existModeTimeout); existModeTimeout = null; }
  clearExistTimer();
  dropOverlay.classList.remove('visible', 'fade-back');
  dropZoneNew.classList.remove('hover');
  dropZoneExist.classList.remove('hover');
  dropZoneTimer.classList.remove('counting');
  dropZoneTimer.style.background = '';
  // Remove card drop-target styles
  document.querySelectorAll('.asset-card.drop-target, .asset-card.drop-over')
    .forEach(c => c.classList.remove('drop-target', 'drop-over'));
}

function clearExistTimer() {
  if (existHoverTimer)  { clearTimeout(existHoverTimer);  existHoverTimer  = null; }
  if (existTimerRAF)    { cancelAnimationFrame(existTimerRAF); existTimerRAF = null; }
  existTimerStart = null;
  dropZoneTimer.classList.remove('counting');
  dropZoneTimer.style.background = '';
}

function startExistTimer() {
  clearExistTimer();
  dropZoneTimer.classList.add('counting');
  existTimerStart = performance.now();

  function tick(now) {
    const elapsed = now - existTimerStart;
    const pct     = Math.min(elapsed / EXIST_DELAY, 1);
    const deg     = Math.round(pct * 360);
    dropZoneTimer.style.background = `conic-gradient(var(--accent2) ${deg}deg, rgba(255,255,255,.1) ${deg}deg)`;
    if (pct < 1) existTimerRAF = requestAnimationFrame(tick);
  }
  existTimerRAF = requestAnimationFrame(tick);

  existHoverTimer = setTimeout(() => {
    addToExistMode = true;
    clearExistTimer();
    // Fade back the overlay, let cards be drop targets
    dropOverlay.classList.add('fade-back');
    document.querySelectorAll('.asset-card[data-asset-id]')
      .forEach(c => c.classList.add('drop-target'));
    // Failsafe: if the drag is cancelled outside the window (no dragleave/drop
    // fires once addToExistMode is true), don't leave the overlay stuck open.
    if (existModeTimeout) clearTimeout(existModeTimeout);
    existModeTimeout = setTimeout(() => {
      resetDragState();
    }, EXIST_MODE_TIMEOUT);
  }, EXIST_DELAY);
}

// ── Document-level drag events ──
document.addEventListener('dragenter', e => {
  e.preventDefault();
  dragCounter++;
  if (!addToExistMode) dropOverlay.classList.add('visible');
});

document.addEventListener('dragleave', e => {
  dragCounter--;
  if (dragCounter <= 0 && !addToExistMode) {
    resetDragState();
  }
});

document.addEventListener('dragover', e => e.preventDefault());

window.addEventListener('dragend', () => resetDragState());

document.addEventListener('drop', e => {
  e.preventDefault();
  if (!addToExistMode) resetDragState();
  // File path resolved in preload capture-phase listener
});

// ── Zone hover events ──
dropZoneNew.addEventListener('dragenter', () => {
  if (addToExistMode) return;
  clearExistTimer();
  dropZoneNew.classList.add('hover');
  dropZoneExist.classList.remove('hover');
});
dropZoneNew.addEventListener('dragleave', () => dropZoneNew.classList.remove('hover'));
dropZoneNew.addEventListener('drop', () => {
  // preload handles the actual import modal opening
  resetDragState();
});

dropZoneExist.addEventListener('dragenter', () => {
  if (addToExistMode) return;
  dropZoneExist.classList.add('hover');
  dropZoneNew.classList.remove('hover');
  startExistTimer();
});
dropZoneExist.addEventListener('dragleave', () => {
  if (addToExistMode) return;
  dropZoneExist.classList.remove('hover');
  clearExistTimer();
});
dropZoneExist.addEventListener('drop', e => {
  e.stopPropagation();
  resetDragState();
  // Dropped on right box but no card chosen — do nothing
});

// ── Card drop targets (add-to-existing mode) ──
document.addEventListener('dragenter', e => {
  if (!addToExistMode) return;
  const card = e.target.closest('.asset-card[data-asset-id]');
  if (card) {
    document.querySelectorAll('.asset-card.drop-over').forEach(c => c.classList.remove('drop-over'));
    card.classList.add('drop-over');
  }
}, true);

document.addEventListener('dragleave', e => {
  if (!addToExistMode) return;
  const card = e.target.closest('.asset-card[data-asset-id]');
  if (card && !card.contains(e.relatedTarget)) card.classList.remove('drop-over');
}, true);

document.addEventListener('drop', e => {
  if (!addToExistMode) return;
  const card = e.target.closest('.asset-card[data-asset-id]');
  resetDragState();
  if (card && card.dataset.assetId) {
    window.api.addFileToAsset(card.dataset.assetId, null); // path resolved in preload
    pendingHighlight = card.dataset.assetId;
    setTimeout(() => loadLibrary(searchInput.value), 300);
  }
}, true);

// ── Context menu ────────────────────────────────────────────────────────────
const ctxMenu = document.createElement('div');
ctxMenu.id = 'ctx-menu';
ctxMenu.style.display = 'none';
document.body.appendChild(ctxMenu);

function showCtxMenu(x, y, items) {
  ctxMenu.innerHTML = '';
  for (const item of items) {
    if (item === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'ctx-separator';
      ctxMenu.appendChild(sep);
    } else {
      const btn = document.createElement('button');
      btn.className = 'ctx-item' + (item.danger ? ' ctx-item--danger' : '');
      btn.textContent = item.label;
      btn.addEventListener('click', () => { hideCtxMenu(); item.action(); });
      ctxMenu.appendChild(btn);
    }
  }
  ctxMenu.style.display = 'block';
  // Keep menu inside viewport
  const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
  ctxMenu.style.left = (x + mw > window.innerWidth  ? x - mw : x) + 'px';
  ctxMenu.style.top  = (y + mh > window.innerHeight ? y - mh : y) + 'px';
}

function hideCtxMenu() { ctxMenu.style.display = 'none'; }

document.addEventListener('click', hideCtxMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtxMenu(); });

// ── Card glow ────────────────────────────────────────────────────────────────
let pendingHighlight = null;

function glowCard(assetId) {
  if (!assetId) return;
  const card = document.querySelector(`.asset-card[data-asset-id="${assetId}"]`);
  if (!card) return;
  card.classList.remove('glow');
  void card.offsetWidth; // force reflow to restart animation
  card.classList.add('glow');
  card.addEventListener('animationend', () => card.classList.remove('glow'), { once: true });
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Library ──────────────────────────────────────────────────────────────────
async function loadLibrary(filter = '') {
  const [assets, boothResult] = await Promise.all([
    window.api.getAssets(),
    window.api.getBoothItems(),
  ]);

  const boothItems = Array.isArray(boothResult) ? boothResult : [];

  const boothNormalised = boothItems.map(b => ({
    id: null,
    boothId: b.boothId,
    name: b.name,
    thumbnailPath: null,
    thumbnailUrl: b.thumbnailUrl,
    importedAt: b.importedAt,
    originUrl: '',
    localFolder: b.localFolder || '',
    tags: b.tags || [],
    source: 'booth',
  }));

  let all = [...assets, ...boothNormalised];

  // Build tag counts from full unfiltered list
  allTagCounts = {};
  all.forEach(a => (a.tags || []).forEach(t => { allTagCounts[t] = (allTagCounts[t] || 0) + 1; }));

  // Build threat level counts from full unfiltered list
  allThreatCounts = {};
  all.forEach(a => { const s = a.scanStatus || 'untested'; allThreatCounts[s] = (allThreatCounts[s] || 0) + 1; });

  let filtered = filter
    ? all.filter(a => a.name.toLowerCase().includes(filter.toLowerCase()) || (a.id || '').toLowerCase().includes(filter.toLowerCase()))
    : all;

  // Apply tag filter (all selected tags must match — AND logic)
  if (activeTagFilters.size > 0) {
    filtered = filtered.filter(a => {
      const assetTags = a.tags || [];
      return [...activeTagFilters].every(t => assetTags.includes(t));
    });
  }

  // Apply threat level filter (any selected level matches — OR logic)
  if (activeThreatFilters.size > 0) {
    filtered = filtered.filter(a => activeThreatFilters.has(a.scanStatus || 'untested'));
  }

  // Apply adult content filter
  if (adultFilterMode === 'hide') {
    filtered = filtered.filter(a => !a.isAdult);
  } else if (adultFilterMode === 'only') {
    filtered = filtered.filter(a => a.isAdult);
  }

  if (sortMode === 'alpha') {
    filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  } else {
    filtered = [...filtered].sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
  }

  // Refresh dropdown lists if they're open
  if (filterDropdown.style.display !== 'none') renderFilterTagList(filterTagSearch.value);
  if (threatFilterDropdown.style.display !== 'none') renderThreatFilterList();

  // Re-surface any unacknowledged malware flags (e.g. after an app restart)
  for (const asset of assets) {
    if (['critical', 'high', 'medium'].includes(asset.scanStatus) && !asset.scanAcknowledged && !asset.scanMarkedSafe) {
      showMalwareAlert({
        assetId: asset.id, name: asset.name, severity: asset.scanStatus,
        score: asset.scanScore, findings: asset.scanFindings, scannedFile: asset.scanFile,
        recommendation: asset.scanRecommendation, output: asset.scanOutput || '',
      });
    }
  }

  // Pagination
  renderPagination(filtered.length);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  grid.innerHTML = '';
  emptyState.style.display = filtered.length === 0 ? 'block' : 'none';

  for (const asset of paginated) {
    const card = document.createElement('div');
    card.className = 'asset-card';
    if (asset.source === 'booth') card.classList.add('asset-card--booth');
    if (asset.downloadStatus === 'pending') card.classList.add('asset-card--pending');
    const isConcerning = ['critical', 'high', 'medium'].includes(asset.scanStatus);
    // Marked-safe assets keep their true severity color on the dot/badge (so
    // the underlying scan result is still visible and reachable), they just
    // don't get the attention-grabbing card border/highlight anymore.
    if (isConcerning && !asset.scanMarkedSafe) card.classList.add('asset-card--flagged', `asset-card--flagged-${asset.scanStatus}`);
    // High/Critical stay grayed out until the user explicitly marks the asset
    // safe or unsafe (both set scanAcknowledged) — Close alone doesn't count.
    if (['critical', 'high'].includes(asset.scanStatus) && !asset.scanAcknowledged) card.classList.add('asset-card--grayed');
    if (asset.id) card.dataset.assetId = asset.id;
    card.title = asset.originUrl || '';

    let thumbHtml;
    if (safeImageUrl(asset.thumbnailUrl)) {
      thumbHtml = `<img class="asset-thumb" src="${escHtml(safeImageUrl(asset.thumbnailUrl))}" alt="${escHtml(asset.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
                   <div class="asset-thumb-placeholder" style="display:none">📦</div>`;
    } else if (safeImageUrl(asset.thumbnailPath, true)) {
      thumbHtml = `<img class="asset-thumb" src="${escHtml(safeImageUrl(asset.thumbnailPath, true))}" alt="${escHtml(asset.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
                   <div class="asset-thumb-placeholder" style="display:none">📦</div>`;
    } else {
      thumbHtml = `<div class="asset-thumb-placeholder">📦</div>`;
    }

    const date = asset.importedAt ? new Date(asset.importedAt).toLocaleDateString() : '';
    const boothBadge = asset.source === 'booth'
      ? '<img class="booth-badge" src="../assets/booth.png" alt="Booth" />'
      : '';

    const originLinkHtml = asset.originUrl
      ? `<button class="card-origin-link" title="Open original listing" aria-label="Open original listing">↗</button>`
      : '';

    const scanBadgeHtml = isConcerning
      ? `<button class="scan-badge scan-badge--${asset.scanStatus}" title="${asset.scanMarkedSafe ? 'Marked safe by you — click for details' : 'Malware scan flagged this asset — click for details'}">⚠</button>`
      : '';

    const SCAN_DOT_LABELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', clean: 'Clean', error: 'Scan error' };
    const scanDotStatus = SCAN_DOT_LABELS[asset.scanStatus] ? asset.scanStatus : 'untested';
    const scanDotLabel = asset.scanMarkedSafe
      ? `${SCAN_DOT_LABELS[asset.scanStatus] || asset.scanStatus} (marked safe by you)`
      : (SCAN_DOT_LABELS[asset.scanStatus] || 'Not scanned yet');
    const scanDotTag = asset.scanStatus ? 'button' : 'span';
    const scanDotHtml = `<${scanDotTag} class="scan-dot scan-dot--${scanDotStatus}" title="Malware scan: ${scanDotLabel}${asset.scanStatus ? ' — click for details' : ''}"></${scanDotTag}>`;

    const isPending = asset.downloadStatus === 'pending';
    const initPercent = (asset.id && pendingDownloads[asset.id]) || 0;
    const pendingOverlay = isPending
      ? `<div class="card-pending-overlay">
           <span class="card-pending-label">Downloading…</span>
         </div>
         <div class="card-dl-bar-wrap">
           <div class="card-dl-bar" style="width:${initPercent}%"></div>
         </div>`
      : '';

    const tags = asset.tags || [];
    const MAX_TAGS = 3;
    const visibleTags = tags.slice(0, MAX_TAGS);
    const extraCount = tags.length - MAX_TAGS;
    const adultPillHtml = asset.isAdult
      ? `<span class="tag-pill tag-pill--adult" title="Adult content (R-18)">🔞</span>`
      : '';
    const tagHtml = (visibleTags.length || adultPillHtml)
      ? `<div class="card-tags">
          ${adultPillHtml}
          ${visibleTags.map(t => `<span class="tag-pill tag-pill--card" data-tag="${escHtml(t)}">${escHtml(t)}</span>`).join('')}
          ${extraCount > 0 ? `<span class="tag-pill tag-pill--more">+${extraCount}</span>` : ''}
         </div>`
      : '';

    card.innerHTML = `
      <div class="asset-thumb-wrap">
        ${thumbHtml}
        ${boothBadge}
        ${originLinkHtml}
        ${scanBadgeHtml}
        ${pendingOverlay}
      </div>
      <div class="asset-info">
        <div class="asset-name">${escHtml(asset.name)}</div>
        ${tagHtml}
        <div class="asset-date">${date}${scanDotHtml}</div>
      </div>`;

    // ── Click handling: delay single-click to disambiguate from double-click ──
    let clickTimer = null;
    const CLICK_DELAY = 250;

    card.addEventListener('click', () => {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        // Single click action
        if (asset.source === 'booth') {
          if (asset.localFolder) window.api.openBoothFolder(asset.localFolder);
        } else if (asset.id) {
          window.api.openEditModal({ ...asset, tags: asset.tags || [] });
        }
      }, CLICK_DELAY);
    });

    card.addEventListener('dblclick', () => {
      clearTimeout(clickTimer); // cancel the pending single-click
      // Double click action
      if (asset.source === 'booth') {
        if (asset.localFolder) window.api.openBoothFolder(asset.localFolder);
      } else if (asset.id) {
        window.api.openAssetFolder(asset.id);
      }
    });

    if (!asset.localFolder && asset.source === 'booth') card.style.cursor = 'default';

    // ── Origin link: open the item's source URL ──
    const originLinkEl = card.querySelector('.card-origin-link');
    if (originLinkEl) {
      originLinkEl.addEventListener('click', e => {
        e.stopPropagation();
        window.api.openExternal(asset.originUrl);
      });
      originLinkEl.addEventListener('dblclick', e => e.stopPropagation());
    }

    // ── Scan badge / status dot: open the malware scan report for this asset ──
    const openThisAssetScanModal = () => openScanDetailsModal({
      assetId: asset.id, name: asset.name, severity: asset.scanStatus,
      score: asset.scanScore, findings: asset.scanFindings, scannedFile: asset.scanFile,
      recommendation: asset.scanRecommendation, output: asset.scanOutput || '',
    });
    const scanBadgeEl = card.querySelector('.scan-badge');
    if (scanBadgeEl) {
      scanBadgeEl.addEventListener('click', e => { e.stopPropagation(); openThisAssetScanModal(); });
      scanBadgeEl.addEventListener('dblclick', e => e.stopPropagation());
    }
    const scanDotEl = card.querySelector('.scan-dot');
    if (scanDotEl && scanDotEl.tagName === 'BUTTON') {
      scanDotEl.addEventListener('click', e => { e.stopPropagation(); openThisAssetScanModal(); });
      scanDotEl.addEventListener('dblclick', e => e.stopPropagation());
    }

    // ── Tag pill clicks: filter by tag ──
    card.querySelectorAll('.tag-pill--card').forEach(pill => {
      pill.addEventListener('click', e => {
        e.stopPropagation();
        setTagFilter(pill.dataset.tag);
      });
    });

    // ── Right-click: context menu ──
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();

      if (asset.source === 'booth') {
        // Booth items: open folder only (no edit/delete since we don't own the data)
        showCtxMenu(e.clientX, e.clientY, [
          asset.localFolder
            ? { label: '📂  Open folder', action: () => window.api.openBoothFolder(asset.localFolder) }
            : null,
          { label: '🙈  Hide', action: async () => {
              const key = 'booth:' + asset.boothId;
              console.log('[Hide BLM] storing key:', key);
              await window.api.hideAsset(key);
              loadLibrary(searchInput.value);
            }},
        ].filter(Boolean));
      } else {
        const hasUnityPackage = (asset.files || []).some(f => ['.unitypackage', '.zip', '.rar', '.7z'].some(ext => f.toLowerCase().endsWith(ext)));
        showCtxMenu(e.clientX, e.clientY, [
          { label: '✏️  Edit', action: () => window.api.openEditModal({ ...asset, tags: asset.tags || [] }) },
          { label: '🙈  Hide', action: async () => {
              await window.api.hideAsset(asset.id);
              loadLibrary(searchInput.value);
            }},
          'separator',
          { label: '🛡️  Scan for Malware', action: () => scanAssetsForMalware([asset.id]) },
          hasUnityPackage ? { label: '🎮  Add to project', action: () => importAssetToUnity(asset) } : null,
          'separator',
          { label: '🗑  Delete', danger: true, action: async () => {
              if (!confirm(`Delete "${asset.name}" and all its files? This cannot be undone.`)) return;
              await window.api.deleteAsset(asset.id);
              loadLibrary(searchInput.value);
            }},
        ].filter(Boolean));
      }
    });

    grid.appendChild(card);
  }

  // Glow the card that was just modified
  if (pendingHighlight) {
    const id = pendingHighlight;
    pendingHighlight = null;
    requestAnimationFrame(() => glowCard(id));
  }
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeImageUrl(value, local = false) {
  if (typeof value !== 'string' || value.length > 4096) return '';
  if (local) return value ? `file://${value.replace(/\\/g, '/')}` : '';
  try { return new URL(value).protocol === 'https:' ? value : ''; } catch { return ''; }
}

// ── Per-card asset download progress ─────────────────────────────────────────
const pendingDownloads = {}; // assetId → percent

window.api.onAssetDownloadProgress(({ assetId, percent, done }) => {
  if (done) {
    delete pendingDownloads[assetId];
    pendingHighlight = assetId;
  } else {
    pendingDownloads[assetId] = percent;
  }
  // Update just the specific card if it's in the DOM
  const card = document.querySelector(`.asset-card[data-asset-id="${assetId}"]`);
  if (card) {
    if (done) {
      card.classList.remove('asset-card--pending');
      const bar = card.querySelector('.card-dl-bar');
      if (bar) bar.parentElement.remove();
    } else {
      const bar = card.querySelector('.card-dl-bar');
      if (bar) bar.style.width = percent + '%';
    }
  }
});

// ── Download queue panel ─────────────────────────────────────────────────────
const queuePanel       = document.getElementById('queue-panel');
const queueActive      = document.getElementById('queue-active');
const queuePendingList = document.getElementById('queue-pending-list');

function renderQueue({ active, pending }) {
  const hasContent = active || pending.length > 0;
  queuePanel.style.display = hasContent ? 'flex' : 'none';

  // Active item
  queueActive.innerHTML = '';
  if (active) {
    const pct = active.percent || 0;
    const queueBadge = pending.length > 0
      ? ` <span class="queue-badge">+${pending.length} in queue</span>`
      : '';
    queueActive.innerHTML = `
      <div class="queue-active-row">
        <div class="dl-bar-track"><div class="dl-bar" style="width:${pct}%"></div></div>
        <span class="dl-pct">${pct}%</span>
        <span class="dl-label">${escHtml(active.fileName)}${queueBadge}</span>
        <button class="queue-cancel-btn" data-id="${active.id}" title="Cancel">✕</button>
      </div>`;
    queueActive.querySelector('.queue-cancel-btn').addEventListener('click', () => {
      window.api.cancelQueueItem(active.id);
    });
  }

  queuePendingList.innerHTML = '';
}

window.api.onQueueUpdate(renderQueue);

// Restore queue state on load
window.api.getQueue().then(renderQueue);

// ── Download progress bar ────────────────────────────────────────────────────
const dlProgress = document.getElementById('dl-progress');
const dlLabel    = document.getElementById('dl-label');
const dlBar      = document.getElementById('dl-bar');
const dlPct      = document.getElementById('dl-pct');

window.api.onDownloadProgress(({ itemId, percent, done }) => {
  if (done) {
    dlProgress.style.display = 'none';
    window.api.setWindowTitle(null);
    loadLibrary(searchInput.value);
    return;
  }
  const label = `Downloading booth asset: ${itemId}`;
  dlLabel.textContent = label;
  dlBar.style.width   = percent + '%';
  dlPct.textContent   = percent + '%';
  dlProgress.style.display = 'flex';
  window.api.setWindowTitle(label);
});

// ── Malware scanning UI ──────────────────────────────────────────────────────
// All scan results are shown as a modal window (no banners) — what's
// available in it depends on severity per the scoring table below:
//   Clean (0-30)     — auto-saved, no action required, never auto-popped
//   Low (31-60)      — saved with an audit note, no action required, never auto-popped
//   Medium (61-100)  — manual review recommended, auto-pops a window
//   High (101-150)   — mandatory manual review, auto-pops a window, card grayed out until acted on
//   Critical (151+)  — must be marked unsafe, auto-pops a window, card grayed out until acted on
const malwareModal = document.getElementById('malware-modal');
const malwareModalOverlay = document.getElementById('malware-modal-overlay');
const malwareModalTitle = document.getElementById('malware-modal-title');
const malwareModalDesc = document.getElementById('malware-modal-desc');
const malwareModalName = document.getElementById('malware-modal-name');
const malwareModalOutput = document.getElementById('malware-modal-output');
const malwareModalCopy = document.getElementById('malware-modal-copy');
const malwareModalClose = document.getElementById('malware-modal-close');
const malwareModalFlag = document.getElementById('malware-modal-flag');
const malwareModalSafe = document.getElementById('malware-modal-safe');

let scanAlertQueue = [];
let currentScanAlert = null; // the scan result currently shown in the modal (auto-surfaced or a manual "view details" click)
const autoSurfacedThisSession = new Set(); // assetIds already auto-popped this session — avoids re-popping on every loadLibrary() call

const MODAL_SEVERITY_COPY = {
  critical: { title: '⚠ Mark as Unsafe Required',  desc: 'This asset scored <strong>Critical</strong> (151+) — the antimalware check found strong evidence of compromise. It must be marked unsafe; the card stays grayed out until you do.' },
  high:     { title: '⚠ Mandatory Manual Review',  desc: 'This asset scored <strong>High</strong> (101–150) severity. Review the findings below — the card stays grayed out until you mark it safe or unsafe.' },
  medium:   { title: '⚠ Manual Review Recommended', desc: 'This asset scored <strong>Medium</strong> (61–100) severity. Review is recommended but not required.' },
  low:      { title: 'Scan Details',                desc: 'This asset scored <strong>Low</strong> (31–60) severity — saved with an audit note, no action required.' },
  clean:    { title: 'Scan Details',                desc: 'This asset scored <strong>Clean</strong> (0–30) — auto-saved, no action required.' },
};

// The scanner's raw stdout is JSON meant for machines. Turn it into a short,
// human summary for on-screen display; the raw JSON is only ever copied via
// the "Copy Output" buttons (info.output), never shown to the user directly.
const SEVERITY_LABELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', clean: 'Clean' };

// vrcstorage-scanner findings look like:
// { id, severity, points, location, detail, context, line_numbers }
function scanFindingsSorted(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return [];
  return [...findings].sort((a, b) => (b.points || 0) - (a.points || 0));
}

function findingsTableHtml(findings) {
  const items = scanFindingsSorted(findings);
  if (items.length === 0) return '<p class="malware-no-findings">No detailed findings were reported by the scanner.</p>';
  const rows = items.map(f => {
    if (!f || typeof f !== 'object') return `<tr><td colspan="4">${escHtml(String(f))}</td></tr>`;
    const sev = f.severity || '';
    const detail = f.detail || f.description || f.message || f.name || f.id || 'Unknown finding';
    const loc = f.location || f.file || f.path || '';
    const points = f.points !== null && f.points !== undefined ? f.points : '';
    return `<tr>
      <td><span class="finding-sev finding-sev--${escHtml(String(sev).toLowerCase())}">${escHtml(sev)}</span></td>
      <td>${escHtml(String(points))}</td>
      <td>${escHtml(detail)}</td>
      <td class="finding-loc">${escHtml(loc)}</td>
    </tr>`;
  }).join('');
  return `<table class="findings-table"><thead><tr><th>Severity</th><th>Pts</th><th>Detail</th><th>Location</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function formatScanSummaryText(info) {
  const parts = [`Severity: <b>${escHtml(SEVERITY_LABELS[info.severity] || info.severity)}</b>${typeof info.score === 'number' ? ` (score ${info.score})` : ''}`];
  if (info.recommendation) parts.push(`Recommendation: <b>${escHtml(info.recommendation)}</b>`);
  if (info.scannedFile) parts.push(`File: ${escHtml(info.scannedFile)}`);
  return parts.join('<br>');
}

// Close/Mark as Unsafe are available regardless of severity — Close takes no
// action at all (just dismisses). Mark as Safe is hidden for Critical: a
// Critical finding shouldn't be one click away from being waved off.

function renderScanModal(info) {
  currentScanAlert = info;
  const copy = MODAL_SEVERITY_COPY[info.severity] || { title: 'Scan Details', desc: `Malware scan result: <strong>${SEVERITY_LABELS[info.severity] || info.severity}</strong>.` };
  malwareModal.className = `malware-modal malware-modal--${info.severity || 'unknown'}`;
  malwareModalTitle.textContent = copy.title;
  malwareModalDesc.innerHTML = copy.desc;
  malwareModalName.textContent = info.name;
  document.getElementById('malware-modal-summary').innerHTML = formatScanSummaryText(info);
  malwareModalOutput.innerHTML = findingsTableHtml(info.findings);
  malwareModalSafe.style.display = info.severity === 'critical' ? 'none' : '';
  malwareModalOverlay.style.display = 'flex';
}

// Advances the queue of automatically-surfaced Medium/High/Critical alerts
// (shown one window at a time). Also doubles as "close" for the modal in
// general — if nothing else is queued it just hides the overlay.
function advanceScanAlertQueue() {
  const next = scanAlertQueue.shift() || null;
  if (!next) { currentScanAlert = null; malwareModalOverlay.style.display = 'none'; return; }
  renderScanModal(next);
}

// Opens the details modal on demand (e.g. clicking the scan badge/dot on a
// card), for any severity, independent of the auto-surfaced queue above.
function openScanDetailsModal(info) {
  renderScanModal(info);
}

// Clean/Low results need no attention (per the scoring table) so they never
// auto-pop a window — only Medium/High/Critical do, one at a time, and only
// once per asset per session so re-rendering the library (search, sort,
// filter…) doesn't keep reopening a window the user already closed.
function showMalwareAlert(info) {
  if (!['critical', 'high', 'medium'].includes(info.severity)) return;
  if (autoSurfacedThisSession.has(info.assetId)) return;
  autoSurfacedThisSession.add(info.assetId);
  scanAlertQueue = scanAlertQueue.filter(i => i.assetId !== info.assetId);
  scanAlertQueue.push(info);
  if (!currentScanAlert) advanceScanAlertQueue();
}

malwareModalCopy.addEventListener('click', () => window.api.copyToClipboard(currentScanAlert ? currentScanAlert.output || '' : ''));
malwareModalClose.addEventListener('click', () => advanceScanAlertQueue());
malwareModalFlag.addEventListener('click', async () => {
  if (currentScanAlert) {
    await window.api.malwareMarkUnsafe(currentScanAlert.assetId);
    loadLibrary(searchInput.value);
  }
  advanceScanAlertQueue();
});
malwareModalSafe.addEventListener('click', async () => {
  if (currentScanAlert) {
    await window.api.malwareMarkSafe(currentScanAlert.assetId);
    loadLibrary(searchInput.value);
  }
  advanceScanAlertQueue();
});

window.api.onMalwareScanFlagged(info => showMalwareAlert(info));

const SCAN_STATUS_MESSAGES = {
  'not-available': 'The malware scanner hasn\'t finished downloading yet. Try again in a moment.',
  'no-files': 'Nothing scannable in this asset (no .unitypackage, .zip, .rar, or .7z files).',
  'already-running': 'A scan for this asset is already running.',
  'disabled': 'Malware scanning is turned off in Settings.',
  'error': 'Could not start the scan — the asset files may be missing.',
};

const IMPORT_UNITY_ERROR_MESSAGES = {
  'no-project': 'No open Unity project detected. Install the companion package (Settings → Unity Import) and make sure the project is open.',
  'invalid-project': "That Unity project doesn't look valid anymore (missing Assets/ProjectSettings).",
  'asset-not-found': 'Could not find this asset\'s files on disk.',
  'no-package': 'This asset has no .unitypackage file to import.',
  'no-files-selected': 'Select at least one file to import.',
};

async function showUnityImportDialog(asset, projects) {
  const overlay = document.createElement('div');
  overlay.className = 'unity-import-overlay';
  overlay.innerHTML = '<div class="unity-import-dialog unity-import-loading" role="dialog" aria-modal="true" aria-busy="true"><div class="unity-import-spinner" aria-hidden="true"></div><div class="modal-title">Preparing Unity import</div><p class="unity-import-help">Scanning archive contents. Large files may take a moment…</p></div>';
  document.body.appendChild(overlay);
  const result = await window.api.getUnityImportEntries(asset.id);
  if (!result.ok) { overlay.remove(); alert(IMPORT_UNITY_ERROR_MESSAGES[result.error] || result.error); return; }
  const entries = result.entries || [];
  if (!entries.length) { overlay.remove(); alert('No importable files were found in this asset.'); return; }

  overlay.innerHTML = `<div class="unity-import-dialog" role="dialog" aria-modal="true">
    <div class="modal-title">Add to Unity project</div>
    <p class="unity-import-help">Select the files to copy. Thumbnail and metadata files are hidden.</p>
    ${projects.length > 1 ? '<label class="unity-project-label">Target project<select id="unity-project-select"></select></label>' : `<div class="unity-project-name">Target project: ${escHtml(projects[0].projectName)}</div>`}
    <div class="unity-import-toolbar"><label class="unity-select-all"><input type="checkbox" id="unity-select-all"> <span>Select all visible files</span></label><input type="search" id="unity-import-search" placeholder="Search files…" autocomplete="off"></div>
    <div class="unity-import-files" id="unity-import-files"></div>
    <div class="modal-actions"><button class="btn-ghost" id="unity-import-cancel">Cancel</button><button class="btn-primary" id="unity-import-confirm">Add selected files</button></div>
  </div>`;
  document.body.appendChild(overlay);
  const projectSelect = overlay.querySelector('#unity-project-select');
  if (projectSelect) projects.forEach(project => { const option = document.createElement('option'); option.value = project.projectPath; option.textContent = project.projectName; projectSelect.appendChild(option); });
  const files = overlay.querySelector('#unity-import-files');
  entries.forEach(entry => {
    const row = document.createElement('label');
    row.className = 'unity-import-file';
    row.dataset.searchText = `${entry.archive} ${entry.path}`.toLowerCase();
    const entryLabel = entry.unityPackage
      ? (entry.path || entry.archive).split('/').pop()
      : (entry.path && entry.path !== entry.archive ? `${entry.archive} / ${entry.path}` : entry.archive);
    row.innerHTML = `<input type="checkbox" checked data-key="${escHtml(entry.key)}"><span>${escHtml(entryLabel)}</span><small>${entry.unityPackage ? 'Unity package' : `${Math.ceil(entry.size / 1024)} KB`}</small>`;
    files.appendChild(row);
  });
  const selectAll = overlay.querySelector('#unity-select-all');
  const searchInput = overlay.querySelector('#unity-import-search');
  const visibleRows = () => [...files.querySelectorAll('.unity-import-file')].filter(row => row.style.display !== 'none');
  const updateSelectAll = () => {
    const rows = visibleRows();
    const checked = rows.filter(row => row.querySelector('input').checked).length;
    selectAll.checked = rows.length > 0 && checked === rows.length;
    selectAll.indeterminate = checked > 0 && checked < rows.length;
  };
  selectAll.addEventListener('change', () => {
    visibleRows().forEach(row => { row.querySelector('input').checked = selectAll.checked; });
    updateSelectAll();
  });
  files.addEventListener('change', event => {
    if (event.target.matches('input[type="checkbox"]')) updateSelectAll();
  });
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    files.querySelectorAll('.unity-import-file').forEach(row => {
      row.style.display = !query || row.dataset.searchText.includes(query) ? '' : 'none';
    });
    updateSelectAll();
  });
  updateSelectAll();
  const close = () => overlay.remove();
  overlay.querySelector('#unity-import-cancel').addEventListener('click', close);
  overlay.querySelector('#unity-import-confirm').addEventListener('click', async () => {
    const selected = [...files.querySelectorAll('input:checked')].map(input => entries.find(entry => entry.key === input.dataset.key)).filter(Boolean);
    const projectPath = projectSelect ? projectSelect.value : projects[0].projectPath;
    const confirmButton = overlay.querySelector('#unity-import-confirm');
    confirmButton.disabled = true;
    overlay.classList.add('unity-import-is-busy');
    overlay.querySelector('.unity-import-dialog').setAttribute('aria-busy', 'true');
    overlay.querySelector('.unity-import-help').textContent = 'Copying files and waiting for Unity to import the package…';
    const spinner = document.createElement('div');
    spinner.className = 'unity-import-spinner unity-import-spinner--inline';
    confirmButton.before(spinner);
    const importResult = await window.api.importToUnity(asset.id, projectPath, selected);
    close();
    await window.api.focusUnityProject(projectPath);
    if (!importResult.ok) alert(IMPORT_UNITY_ERROR_MESSAGES[importResult.error] || `Could not import: ${importResult.error}`);
  });
}

async function importAssetToUnity(asset) {
  const projects = await window.api.getUnityProjects();

  if (projects.length === 0) {
    alert(IMPORT_UNITY_ERROR_MESSAGES['no-project']);
    return;
  }

  await showUnityImportDialog(asset, projects);
}

async function scanAssetsForMalware(assetIds) {
  const results = await window.api.malwareScanNow(assetIds);
  const problems = Object.entries(results).filter(([, status]) => status !== 'started');
  if (problems.length > 0) {
    const lines = problems.map(([id, status]) => `${id}: ${SCAN_STATUS_MESSAGES[status] || status}`);
    alert(lines.join('\n'));
  }
}

// ── Scan progress bar (footer) ───────────────────────────────────────────────
const scanProgress = document.getElementById('scan-progress');
const scanLabel    = document.getElementById('scan-label');

window.api.onMalwareScanProgress(({ active, label }) => {
  if (!active) { scanProgress.style.display = 'none'; return; }
  scanLabel.textContent = label || 'Scanning…';
  scanProgress.style.display = 'flex';
});

searchInput.addEventListener('input', () => { currentPage = 1; loadLibrary(searchInput.value); });

document.getElementById('btn-settings').addEventListener('click', () => {
  window.location.href = 'settings.html';
});

window.api.onRefreshLibrary(({ assetId } = {}) => {
  if (assetId) pendingHighlight = assetId;
  loadLibrary(searchInput.value);
});

// ── Tab switching ────────────────────────────────────────────────────────────
const tabBtns = document.querySelectorAll('.tab-btn');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.style.display = p.id === 'tab-' + tabId ? '' : 'none';
    });
    // Show/hide library-only header controls
    const isLibrary = tabId === 'library';
    document.querySelectorAll('.library-only').forEach(el => {
      el.style.display = isLibrary ? '' : 'none';
    });
  });
});

updateSortButton();
updateAdultFilterButton();
applyViewMode();
initPagination();
loadLibrary();
