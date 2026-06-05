const grid = document.getElementById('asset-grid');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search');
const btnSort = document.getElementById('btn-sort');
const btnView = document.getElementById('btn-view');
const assetCount = document.getElementById('asset-count');

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

// ── Drag & drop ─────────────────────────────────────────────────────────────
const dropOverlay = document.getElementById('drop-overlay');
let dragCounter = 0; // track nested dragenter/dragleave pairs

document.addEventListener('dragenter', e => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.add('visible');
});

document.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('visible'); }
});

document.addEventListener('dragover', e => e.preventDefault());

document.addEventListener('drop', e => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('visible');
  // Path resolution + modal opening is handled in preload.js (capture phase)
  // to avoid File object cloning through contextBridge
});

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
    source: 'booth',
  }));

  let all = [...assets, ...boothNormalised];

  // Update asset counter
  const localCount = assets.length;
  const boothCount = boothNormalised.length;
  const totalCount = all.length;
  assetCount.textContent = `${totalCount} assets`;
  assetCount.title = `${localCount} local · ${boothCount} from Booth Library Manager`;

  let filtered = filter
    ? all.filter(a => a.name.toLowerCase().includes(filter.toLowerCase()) || (a.id || '').toLowerCase().includes(filter.toLowerCase()))
    : all;

  if (sortMode === 'alpha') {
    filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  } else {
    filtered = [...filtered].sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
  }

  grid.innerHTML = '';
  emptyState.style.display = filtered.length === 0 ? 'block' : 'none';

  for (const asset of filtered) {
    const card = document.createElement('div');
    card.className = 'asset-card';
    if (asset.source === 'booth') card.classList.add('asset-card--booth');
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
    card.innerHTML = `
      <div class="asset-thumb-wrap">
        ${thumbHtml}
        ${boothBadge}
      </div>
      <div class="asset-info">
        <div class="asset-name">${escHtml(asset.name)}</div>
        <div class="asset-date">${date}</div>
      </div>`;

    // ── Left-click: open folder ──
    if (asset.source === 'booth') {
      if (asset.localFolder) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => window.api.openBoothFolder(asset.localFolder));
      } else {
        card.style.cursor = 'default';
      }
    } else if (asset.id) {
      card.addEventListener('click', () => window.api.openAssetFolder(asset.id));
    }

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
          { label: '✏️  Edit', action: () => window.api.openEditModal(asset) },
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
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Download progress bar ────────────────────────────────────────────────────
const dlProgress = document.getElementById('dl-progress');
const dlLabel    = document.getElementById('dl-label');
const dlBar      = document.getElementById('dl-bar');
const dlPct      = document.getElementById('dl-pct');

window.api.onDownloadProgress(({ itemId, percent, done }) => {
  if (done) {
    dlProgress.style.display = 'none';
    return;
  }
  dlLabel.textContent = `Downloading booth asset: ${itemId}`;
  dlBar.style.width   = percent + '%';
  dlPct.textContent   = percent + '%';
  dlProgress.style.display = 'flex';
});

searchInput.addEventListener('input', () => loadLibrary(searchInput.value));

document.getElementById('btn-settings').addEventListener('click', () => {
  window.location.href = 'settings.html';
});

window.api.onRefreshLibrary(() => loadLibrary(searchInput.value));

updateSortButton();
applyViewMode();
loadLibrary();
