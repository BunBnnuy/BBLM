const grid = document.getElementById('asset-grid');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search');
const btnSort = document.getElementById('btn-sort');
const btnView = document.getElementById('btn-view');
const assetCount = document.getElementById('asset-count');

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
  const active = [...activeTagFilters];
  tagFilterBar.style.display = active.length ? 'flex' : 'none';
  tagFilterChips.innerHTML = active
    .map(t => `<span class="tag-pill tag-pill--active" data-tag="${escHtml(t)}">${escHtml(t)}<button class="tag-pill-remove" style="background:none;border:none;color:inherit;cursor:pointer;font-size:11px;padding:0 0 0 3px;">×</button></span>`)
    .join('');
  tagFilterChips.querySelectorAll('.tag-pill-remove').forEach(btn => {
    btn.addEventListener('click', () => toggleTagFilter(btn.parentElement.dataset.tag));
  });
  // Update filter button style
  btnFilter.classList.toggle('btn-filter--active', active.length > 0);
  btnFilter.textContent = active.length ? `⌖ Tags (${active.length})` : '⌖ Tags';
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
  updateFilterBar();
  loadLibrary(searchInput.value);
});

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

btnSort.addEventListener('click', () => {
  sortMode = sortMode === 'date' ? 'alpha' : 'date';
  localStorage.setItem('sortMode', sortMode);
  updateSortButton();
  loadLibrary(searchInput.value);
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
const EXIST_DELAY    = 500;

function resetDragState() {
  dragCounter = 0;
  addToExistMode = false;
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

  // Update asset counter
  const localCount = assets.length;
  const boothCount = boothNormalised.length;
  const totalCount = all.length;
  assetCount.textContent = `${totalCount} assets`;
  assetCount.title = `${localCount} local · ${boothCount} from Booth Library Manager`;

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

  if (sortMode === 'alpha') {
    filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  } else {
    filtered = [...filtered].sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
  }

  // Refresh dropdown list if it's open
  if (filterDropdown.style.display !== 'none') renderFilterTagList(filterTagSearch.value);

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
    if (asset.id) card.dataset.assetId = asset.id;
    card.title = asset.originUrl || '';

    let thumbHtml;
    if (asset.thumbnailUrl) {
      thumbHtml = `<img class="asset-thumb" src="${asset.thumbnailUrl}" alt="${escHtml(asset.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
                   <div class="asset-thumb-placeholder" style="display:none">📦</div>`;
    } else if (asset.thumbnailPath) {
      thumbHtml = `<img class="asset-thumb" src="file://${asset.thumbnailPath.replace(/\\/g, '/')}" alt="${escHtml(asset.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
                   <div class="asset-thumb-placeholder" style="display:none">📦</div>`;
    } else {
      thumbHtml = `<div class="asset-thumb-placeholder">📦</div>`;
    }

    const date = asset.importedAt ? new Date(asset.importedAt).toLocaleDateString() : '';
    const boothBadge = asset.source === 'booth'
      ? '<img class="booth-badge" src="../assets/booth.png" alt="Booth" />'
      : '';

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
    const tagHtml = visibleTags.length
      ? `<div class="card-tags">
          ${visibleTags.map(t => `<span class="tag-pill tag-pill--card" data-tag="${escHtml(t)}">${escHtml(t)}</span>`).join('')}
          ${extraCount > 0 ? `<span class="tag-pill tag-pill--more">+${extraCount}</span>` : ''}
         </div>`
      : '';

    card.innerHTML = `
      <div class="asset-thumb-wrap">
        ${thumbHtml}
        ${boothBadge}
        ${pendingOverlay}
      </div>
      <div class="asset-info">
        <div class="asset-name">${escHtml(asset.name)}</div>
        ${tagHtml}
        <div class="asset-date">${date}</div>
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
        showCtxMenu(e.clientX, e.clientY, [
          { label: '✏️  Edit', action: () => window.api.openEditModal({ ...asset, tags: asset.tags || [] }) },
          { label: '🙈  Hide', action: async () => {
              await window.api.hideAsset(asset.id);
              loadLibrary(searchInput.value);
            }},
          'separator',
          { label: '🗑  Delete', danger: true, action: async () => {
              if (!confirm(`Delete "${asset.name}" and all its files? This cannot be undone.`)) return;
              await window.api.deleteAsset(asset.id);
              loadLibrary(searchInput.value);
            }},
        ]);
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
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    // Show/hide library-only topbar controls
    const isLibrary = tabId === 'library';
    document.querySelectorAll('.library-only, #library-search-wrap').forEach(el => {
      el.style.display = isLibrary ? '' : 'none';
    });
  });
});

updateSortButton();
applyViewMode();
initPagination();
loadLibrary();
