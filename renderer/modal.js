let resolvedFilePaths = []; // always an array; single file → length 1
let selectedImageUrl = null;
let editMode = false;
let editAssetId = null;
let currentTags = [];  // tags currently on the asset
let allKnownTags = []; // global tag list for autocomplete

const originInput  = document.getElementById('origin-url');
const nameInput    = document.getElementById('asset-name');
const fileInput    = document.getElementById('file-name');
const fileListEl   = document.getElementById('file-list');
const statusEl     = document.getElementById('status');
const imageSection = document.getElementById('image-section');
const imageGrid    = document.getElementById('image-grid');
const btnImport    = document.getElementById('btn-import');
const btnBrowse    = document.getElementById('btn-browse');
const modalTitle   = document.getElementById('modal-title');
const fileField    = document.getElementById('file-field');
const tagPills     = document.getElementById('tag-pills');
const tagInput     = document.getElementById('tag-input');
const tagSuggestions = document.getElementById('tag-suggestions');
const isAdultCheckbox = document.getElementById('is-adult');

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
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Init ────────────────────────────────────────────────────────────────────
loadTagSuggestions();

function setStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + type;
}
function clearStatus() { statusEl.className = 'status'; }

function basename(p) { return p.replace(/.*[\\/]/, ''); }

function renderFileList() {
  fileListEl.innerHTML = '';
  resolvedFilePaths.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'file-list-item';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = basename(p);
    nameSpan.title = p;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'file-list-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', () => removeFile(i));
    row.appendChild(nameSpan);
    row.appendChild(removeBtn);
    fileListEl.appendChild(row);
  });
}

function removeFile(index) {
  resolvedFilePaths.splice(index, 1);
  setFiles(resolvedFilePaths);
}

function setFiles(paths) {
  resolvedFilePaths = paths || [];
  const nameField = nameInput.closest('.field');

  if (resolvedFilePaths.length > 1) {
    fileInput.style.display = 'none';
    fileListEl.style.display = 'block';
    renderFileList();
    nameField.style.display = '';
    setStatus(`${resolvedFilePaths.length} files selected — with an origin URL they become one asset; without one, each is imported separately.`, 'info');
  } else if (resolvedFilePaths.length === 1) {
    fileInput.style.display = 'none';
    fileListEl.style.display = 'block';
    renderFileList();
    nameField.style.display = '';
    const slug = basename(resolvedFilePaths[0]).replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    if (!nameInput.value) nameInput.value = slug.charAt(0).toUpperCase() + slug.slice(1);
    setStatus('✔ File ready: ' + resolvedFilePaths[0], 'success');
  } else {
    // No files — reset to empty state
    fileInput.style.display = '';
    fileInput.value = '';
    fileListEl.style.display = 'none';
    nameField.style.display = '';
    clearStatus();
  }
  checkReady();
}

function checkReady() {
  btnImport.disabled = editMode ? !nameInput.value.trim() : resolvedFilePaths.length === 0;
}
nameInput.addEventListener('input', checkReady);

// ── Browse button ────────────────────────────────────────────────────────────
btnBrowse.addEventListener('click', async () => {
  const paths = await window.api.pickFiles();
  if (!paths || paths.length === 0) return;
  setFiles(paths);
});

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
    isAdultCheckbox.checked = !!data.isAdult;

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
    renderAssetSuggestions();
    if (data.originUrl) originInput.value = data.originUrl;
    if (data.fileName)  fileInput.value   = data.fileName;
    if (data.originUrl) autoFillName(data.originUrl);

    if (data.filePaths && data.filePaths.length > 0) {
      setFiles(data.filePaths);
      // A known origin means the files belong to one asset — fetch its data
      // regardless of how many files came in.
      if (data.originUrl) {
        autoFetch(data.originUrl);
      }
    } else if (data.filePath) {
      setFiles([data.filePath]);
      if (!data.originUrl && data.fileName) {
        const slug = data.fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        nameInput.value = slug.charAt(0).toUpperCase() + slug.slice(1);
      }
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

  if (result.name) nameInput.value = result.name;

  if (result.tags && result.tags.length) {
    result.tags.forEach(t => addTag(t));
  }

  if (result.isAdult) isAdultCheckbox.checked = true;

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

  // Auto-select the first image — use the original URL from the data, not el.src,
  // because the browser may resolve/rewrite it (e.g. stripping query params).
  if (result.images.length > 0) {
    const firstEl = imageGrid.querySelector('img:not([data-existing])');
    if (firstEl) firstEl.classList.add('selected');
    selectedImageUrl = result.images[0].url;
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
  const isAdult   = isAdultCheckbox.checked;

  if (editMode) {
    if (!assetName) return setStatus('Asset name is required.', 'error');
    setStatus('⏳ Saving…', 'info');
    btnImport.disabled = true;
    try {
      const result = await window.api.updateAsset({ assetId: editAssetId, name: assetName, originUrl, selectedImageUrl, tags, isAdult });
      setStatus('✔ Saved "' + result.meta.name + '"', 'success');
      window.api.refreshLibrary(result.assetId);
      setTimeout(() => window.api.closeModal(), 1200);
    } catch (err) {
      setStatus('Save failed: ' + err.message, 'error');
      btnImport.disabled = false;
    }
  } else {
    if (resolvedFilePaths.length === 0) return setStatus('No file selected yet.', 'error');
    btnImport.disabled = true;

    if (resolvedFilePaths.length === 1) {
      // Single-file import — same as before
      if (!originUrl) return setStatus('Origin URL is required.', 'error');
      setStatus('⏳ Importing…', 'info');
      try {
        const result = await window.api.importAsset({ originUrl, filePath: resolvedFilePaths[0], selectedImageUrl, assetName: assetName || null, tags, isAdult });
        setStatus('✔ Imported as "' + result.meta.name + '" (ID: ' + result.assetId + ')', 'success');
        window.api.refreshLibrary(result.assetId);
        setTimeout(() => window.api.closeModal(), 1500);
      } catch (err) {
        setStatus('Import failed: ' + err.message, 'error');
        btnImport.disabled = false;
      }
    } else {
      // Multi-file batch import — files sharing the same origin URL resolve to
      // the same asset, so only the first creates it (with thumbnail/tags);
      // the rest must be appended via addFileToAsset instead of re-running
      // importAsset, which would overwrite meta.json (thumbnail + files list)
      // on every iteration.
      setStatus(`⏳ Importing 0 / ${resolvedFilePaths.length}…`, 'info');
      let done = 0;
      const errors = [];
      let sharedAssetId = null;
      for (const fp of resolvedFilePaths) {
        const autoName = fp.replace(/.*[\\/]/, '').replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        const fileName = autoName.charAt(0).toUpperCase() + autoName.slice(1);
        // With a shared origin the files form one asset, so use the name from the
        // form (populated by "Fetch data"); fall back to the filename only when
        // there's no origin and each file becomes its own asset.
        const name = originUrl ? (assetName || fileName) : fileName;
        try {
          // Only merge into one asset when there's a real shared origin URL —
          // an empty origin means each file is its own untitled asset.
          if (sharedAssetId && originUrl) {
            const result = await window.api.addFileToAsset(sharedAssetId, fp);
            if (result && result.error) throw new Error(result.error);
            window.api.refreshLibrary(sharedAssetId);
          } else {
            const result = await window.api.importAsset({ originUrl: originUrl || '', filePath: fp, selectedImageUrl, assetName: name, tags, isAdult });
            sharedAssetId = result.assetId;
            window.api.refreshLibrary(result.assetId);
          }
          done++;
          setStatus(`⏳ Importing ${done} / ${resolvedFilePaths.length}…`, 'info');
        } catch (err) {
          errors.push(fileName + ': ' + err.message);
        }
      }
      if (errors.length === 0) {
        setStatus(`✔ Imported ${done} asset${done !== 1 ? 's' : ''} successfully.`, 'success');
        setTimeout(() => window.api.closeModal(), 1500);
      } else {
        setStatus(`Imported ${done}, failed ${errors.length}: ${errors[0]}`, 'error');
        btnImport.disabled = false;
      }
    }
  }
});

document.getElementById('btn-cancel').addEventListener('click', () => window.api.closeModal());

// ── Downloads monitor: new file while modal is open ──────────────────────────
const newFilesBanner    = document.getElementById('new-files-banner');
const assetSuggestions  = document.getElementById('asset-suggestions');
const suggestionsStrip  = document.getElementById('suggestions-strip');

document.getElementById('btn-dismiss-banner').addEventListener('click', () => {
  newFilesBanner.style.display = 'none';
});

async function renderAssetSuggestions() {
  const assets = await window.api.getAssets();
  const recent = assets.slice(0, 5);
  if (recent.length === 0) return;

  suggestionsStrip.innerHTML = '';
  for (const asset of recent) {
    const card = document.createElement('button');
    card.className = 'suggestion-card';
    card.title = asset.name;

    const thumb = document.createElement('div');
    thumb.className = 'suggestion-thumb';
    if (asset.thumbnailPath) {
      const img = document.createElement('img');
      img.src = 'file://' + asset.thumbnailPath.replace(/\\/g, '/');
      img.alt = asset.name;
      thumb.appendChild(img);
    } else {
      thumb.textContent = '📦';
    }

    const label = document.createElement('span');
    label.className = 'suggestion-label';
    label.textContent = asset.name;

    card.appendChild(thumb);
    card.appendChild(label);
    card.addEventListener('click', () => addToExistingAsset(asset.id));
    suggestionsStrip.appendChild(card);
  }

  assetSuggestions.style.display = '';
}

async function addToExistingAsset(assetId) {
  btnImport.disabled = true;
  setStatus('⏳ Adding to existing asset…', 'info');
  const errors = [];
  for (const fp of resolvedFilePaths) {
    const result = await window.api.addFileToAsset(assetId, fp);
    if (result && result.error) errors.push(result.error);
  }
  if (errors.length === 0) {
    setStatus('✔ Files added to existing asset.', 'success');
    window.api.refreshLibrary(assetId);
    setTimeout(() => window.api.closeModal(), 1200);
  } else {
    setStatus('Failed: ' + errors[0], 'error');
    btnImport.disabled = false;
  }
}

window.api.onModalFileDetected((data) => {
  if (editMode) return;
  if (!resolvedFilePaths.includes(data.filePath)) {
    resolvedFilePaths.push(data.filePath);
    setFiles(resolvedFilePaths);
  }
  newFilesBanner.style.display = '';
});
