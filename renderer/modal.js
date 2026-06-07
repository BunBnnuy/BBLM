let resolvedFilePath = null;
let selectedImageUrl = null;
let editMode = false;
let editAssetId = null;
let currentTags = [];  // tags currently on the asset
let allKnownTags = []; // global tag list for autocomplete

const originInput  = document.getElementById('origin-url');
const nameInput    = document.getElementById('asset-name');
const fileInput    = document.getElementById('file-name');
const statusEl     = document.getElementById('status');
const imageSection = document.getElementById('image-section');
const imageGrid    = document.getElementById('image-grid');
const btnImport    = document.getElementById('btn-import');
const modalTitle   = document.getElementById('modal-title');
const fileField    = document.getElementById('file-field');
const tagPills     = document.getElementById('tag-pills');
const tagInput     = document.getElementById('tag-input');
const tagSuggestions = document.getElementById('tag-suggestions');

// ── Tag editor ──────────────────────────────────────────────────────────────
function renderTags() {
  tagPills.innerHTML = '';
  currentTags.forEach(tag => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `${escHtml(tag)}<button class="tag-pill-remove" title="Remove">×</button>`;
    pill.querySelector('button').addEventListener('click', () => removeTag(tag));
    tagPills.appendChild(pill);
  });
}

function addTag(tag) {
  tag = tag.trim();
  if (!tag || currentTags.includes(tag)) return;
  currentTags.push(tag);
  renderTags();
}

function removeTag(tag) {
  currentTags = currentTags.filter(t => t !== tag);
  renderTags();
}

function setTags(tags) {
  currentTags = [...(tags || [])];
  renderTags();
}

function loadTagSuggestions() {
  window.api.getAllTags().then(tags => {
    allKnownTags = tags || [];
    tagSuggestions.innerHTML = '';
    allKnownTags.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      tagSuggestions.appendChild(opt);
    });
    tagInput.setAttribute('list', 'tag-suggestions');
  });
}

tagInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag(tagInput.value);
    tagInput.value = '';
  }
});
tagInput.addEventListener('change', () => {
  if (allKnownTags.includes(tagInput.value.trim())) {
    addTag(tagInput.value);
    tagInput.value = '';
  }
});

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Init ────────────────────────────────────────────────────────────────────
loadTagSuggestions();

function setStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + type;
}
function clearStatus() { statusEl.className = 'status'; }

function checkReady() {
  btnImport.disabled = editMode ? !nameInput.value.trim() : !resolvedFilePath;
}
nameInput.addEventListener('input', checkReady);

// ── Pre-fill data from main process ─────────────────────────────────────────
window.api.onImportData((data) => {
  if (data.mode === 'edit') {
    editMode    = true;
    editAssetId = data.id;
    modalTitle.textContent  = 'Edit Asset';
    btnImport.textContent   = 'Save';
    fileField.style.display = 'none';

    if (data.originUrl) originInput.value = data.originUrl;
    if (data.name)      nameInput.value   = data.name;
    setTags(data.tags || []);

    if (data.thumbnailPath) {
      imageSection.style.display = 'block';
      const existing = document.createElement('img');
      existing.src = 'file://' + data.thumbnailPath.replace(/\\/g, '/');
      existing.title = 'Current thumbnail';
      existing.classList.add('selected');
      existing.dataset.existing = 'true';
      existing.addEventListener('click', () => {
        imageGrid.querySelectorAll('img').forEach(i => i.classList.remove('selected'));
        existing.classList.add('selected');
        selectedImageUrl = null;
      });
      imageGrid.appendChild(existing);
    }
    checkReady();
  } else {
    if (data.originUrl) originInput.value = data.originUrl;
    if (data.fileName)  fileInput.value   = data.fileName;
    if (data.originUrl) autoFillName(data.originUrl);

    if (data.filePath) {
      resolvedFilePath = data.filePath;
      setStatus('✔ File ready: ' + data.filePath, 'success');
      checkReady();
      if (!data.originUrl && data.fileName) {
        const slug = data.fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        nameInput.value = slug.charAt(0).toUpperCase() + slug.slice(1);
      }
      // Auto-fetch when opened from a URL scheme download (originUrl already known)
      if (data.originUrl) {
        autoFetch(data.originUrl);
      }
    }
  }
});

function autoFillName(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      const slug = parts[parts.length - 1].replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
      nameInput.value = slug.charAt(0).toUpperCase() + slug.slice(1);
    }
  } catch {}
}

originInput.addEventListener('change', () => {
  if (originInput.value && !nameInput.value) autoFillName(originInput.value);
});

// ── Fetch data (name + images + tags) ───────────────────────────────────────
async function autoFetch(url) {
  if (!url) return;
  setStatus('⏳ Fetching data from page…', 'info');
  Array.from(imageGrid.querySelectorAll('img:not([data-existing])')).forEach(el => el.remove());
  selectedImageUrl = null;

  const result = await window.api.scrapeImages(url);
  if (result.error) return setStatus('Could not fetch page data: ' + result.error, 'info');

  if (result.name && !editMode) nameInput.value = result.name;

  if (result.tags && result.tags.length) {
    result.tags.forEach(t => addTag(t));
  }

  if (!result.images.length) {
    clearStatus();
    return;
  }

  imageSection.style.display = 'block';
  clearStatus();

  for (const img of result.images) {
    const el = document.createElement('img');
    el.src = img.url;
    el.title = img.alt || img.url;
    el.addEventListener('click', () => {
      imageGrid.querySelectorAll('img').forEach(i => i.classList.remove('selected'));
      el.classList.add('selected');
      selectedImageUrl = img.url;
      checkReady();
    });
    imageGrid.appendChild(el);
  }

  // Auto-select the first image
  const first = imageGrid.querySelector('img');
  if (first) {
    first.classList.add('selected');
    selectedImageUrl = first.src;
  }
}

document.getElementById('btn-scrape').addEventListener('click', () => {
  const url = originInput.value.trim();
  if (!url) return setStatus('Enter an origin URL first.', 'error');
  autoFetch(url);
});

// ── Save / Import ────────────────────────────────────────────────────────────
btnImport.addEventListener('click', async () => {
  const originUrl = originInput.value.trim();
  const assetName = nameInput.value.trim();
  const tags      = currentTags;

  if (editMode) {
    if (!assetName) return setStatus('Asset name is required.', 'error');
    setStatus('⏳ Saving…', 'info');
    btnImport.disabled = true;
    try {
      const result = await window.api.updateAsset({ assetId: editAssetId, name: assetName, originUrl, selectedImageUrl, tags });
      setStatus('✔ Saved "' + result.meta.name + '"', 'success');
      window.api.refreshLibrary(result.assetId);
      setTimeout(() => window.api.closeModal(), 1200);
    } catch (err) {
      setStatus('Save failed: ' + err.message, 'error');
      btnImport.disabled = false;
    }
  } else {
    if (!originUrl) return setStatus('Origin URL is required.', 'error');
    if (!resolvedFilePath) return setStatus('No file resolved yet.', 'error');
    setStatus('⏳ Importing…', 'info');
    btnImport.disabled = true;
    try {
      const result = await window.api.importAsset({ originUrl, filePath: resolvedFilePath, selectedImageUrl, assetName: assetName || null, tags });
      setStatus('✔ Imported as "' + result.meta.name + '" (ID: ' + result.assetId + ')', 'success');
      window.api.refreshLibrary(result.assetId);
      setTimeout(() => window.api.closeModal(), 1500);
    } catch (err) {
      setStatus('Import failed: ' + err.message, 'error');
      btnImport.disabled = false;
    }
  }
});

document.getElementById('btn-cancel').addEventListener('click', () => window.api.closeModal());
