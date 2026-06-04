const grid = document.getElementById('asset-grid');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search');
const btnSort = document.getElementById('btn-sort');

let sortMode = localStorage.getItem('sortMode') || 'date'; // 'date' | 'alpha'

function updateSortButton() {
  btnSort.textContent = sortMode === 'date' ? '⇅ Date' : '⇅ A–Z';
}

btnSort.addEventListener('click', () => {
  sortMode = sortMode === 'date' ? 'alpha' : 'date';
  localStorage.setItem('sortMode', sortMode);
  updateSortButton();
  loadLibrary(searchInput.value);
});

async function loadLibrary(filter = '') {
  const assets = await window.api.getAssets();

  let filtered = filter
    ? assets.filter(a => a.name.toLowerCase().includes(filter.toLowerCase()) || a.id.toLowerCase().includes(filter.toLowerCase()))
    : assets;

  // Sort
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
    card.title = asset.originUrl || '';

    let thumbHtml;
    if (asset.thumbnailPath) {
      thumbHtml = `<img class="asset-thumb" src="file://${asset.thumbnailPath.replace(/\\/g, '/')}" alt="${asset.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
                   <div class="asset-thumb-placeholder" style="display:none">📦</div>`;
    } else {
      thumbHtml = `<div class="asset-thumb-placeholder">📦</div>`;
    }

    const date = asset.importedAt ? new Date(asset.importedAt).toLocaleDateString() : '';
    card.innerHTML = `
      ${thumbHtml}
      <div class="asset-info">
        <div class="asset-name">${escHtml(asset.name)}</div>
        <div class="asset-date">${date}</div>
      </div>`;

    card.addEventListener('click', () => window.api.openAssetFolder(asset.id));
    grid.appendChild(card);
  }
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

searchInput.addEventListener('input', () => loadLibrary(searchInput.value));

document.getElementById('btn-settings').addEventListener('click', () => {
  window.location.href = 'settings.html';
});

window.api.onRefreshLibrary(() => loadLibrary(searchInput.value));

updateSortButton();
loadLibrary();
