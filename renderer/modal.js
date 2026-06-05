let resolvedFilePath = null;
let selectedImageUrl = null;
let editMode = false;
let editAssetId = null;

const originInput = document.getElementById('origin-url');
const nameInput = document.getElementById('asset-name');
const fileInput = document.getElementById('file-name');
const statusEl = document.getElementById('status');
const imageSection = document.getElementById('image-section');
const imageGrid = document.getElementById('image-grid');
const btnImport = document.getElementById('btn-import');
const modalTitle = document.getElementById('modal-title');
const fileField = document.getElementById('file-field');

function setStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + type;
}

function clearStatus() { statusEl.className = 'status'; }

function checkReady() {
  if (editMode) {
    btnImport.disabled = !nameInput.value.trim();
  } else {
    btnImport.disabled = !resolvedFilePath;
  }
}

nameInput.addEventListener('input', checkReady);

// Pre-fill data sent from main process
window.api.onImportData((data) => {
  if (data.mode === 'edit') {
    // ── Edit mode ──
    editMode = true;
    editAssetId = data.id;
    modalTitle.textContent = 'Edit Asset';
    btnImport.textContent = 'Save';
    fileField.style.display = 'none'; // no file needed when editing

    if (data.originUrl) originInput.value = data.originUrl;
    if (data.name) nameInput.value = data.name;

    // Show existing thumbnail as first image option
    if (data.thumbnailPath) {
      imageSection.style.display = 'block';
      const existing = document.createElement('img');
      existing.src = 'file://' + data.thumbnailPath.replace(/\\/g, '/');
      existing.title = 'Current thumbnail';
      existing.classList.add('selected');
      // Mark as "keep existing" (no new download needed)
      existing.dataset.existing = 'true';
      existing.addEventListener('click', () => {
        imageGrid.querySelectorAll('img').forEach(i => i.classList.remove('selected'));
        existing.classList.add('selected');
        selectedImageUrl = null; // keep existing
      });
      imageGrid.appendChild(existing);
    }

    checkReady();
  } else {
    // ── Import mode ──
    if (data.originUrl) originInput.value = data.originUrl;
    if (data.fileName) fileInput.value = data.fileName;
    if (data.originUrl) autoFillName(data.originUrl);

    if (data.filePath) {
      resolvedFilePath = data.filePath;
      setStatus('✔ File ready: ' + data.filePath, 'success');
      checkReady();
      if (!data.originUrl && data.fileName) {
        const slug = data.fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        nameInput.value = slug.charAt(0).toUpperCase() + slug.slice(1);
      }
    }
  }
});

function autoFillName(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      const slug = parts[parts.length - 1]
        .replace(/\.[^.]+$/, '')
        .replace(/[-_]+/g, ' ')
        .trim();
      nameInput.value = slug.charAt(0).toUpperCase() + slug.slice(1);
    }
  } catch {}
}

originInput.addEventListener('change', () => {
  if (originInput.value && !nameInput.value) autoFillName(originInput.value);
});

// ── Fetch images ──
document.getElementById('btn-scrape').addEventListener('click', async () => {
  const url = originInput.value.trim();
  if (!url) return setStatus('Enter an origin URL first.', 'error');

  setStatus('⏳ Fetching images from page…', 'info');
  // Clear non-existing thumbnails (keep the existing one in edit mode)
  Array.from(imageGrid.querySelectorAll('img:not([data-existing])')).forEach(el => el.remove());
  selectedImageUrl = null;

  const result = await window.api.scrapeImages(url);
  if (result.error) return setStatus('Error: ' + result.error, 'error');

  if (result.name && !editMode) nameInput.value = result.name;
  if (!result.images.length) return setStatus('No images found on that page.', 'info');

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
});

// ── Save / Import ──
btnImport.addEventListener('click', async () => {
  const originUrl = originInput.value.trim();
  const assetName = nameInput.value.trim();

  if (editMode) {
    if (!assetName) return setStatus('Asset name is required.', 'error');
    setStatus('⏳ Saving…', 'info');
    btnImport.disabled = true;
    try {
      const result = await window.api.updateAsset({
        assetId: editAssetId,
        name: assetName,
        originUrl,
        selectedImageUrl,
      });
      setStatus('✔ Saved "' + result.meta.name + '"', 'success');
      window.api.refreshLibrary();
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
      const result = await window.api.importAsset({
        originUrl,
        filePath: resolvedFilePath,
        selectedImageUrl,
        assetName: assetName || null,
      });
      setStatus('✔ Imported as "' + result.meta.name + '" (ID: ' + result.assetId + ')', 'success');
      window.api.refreshLibrary();
      setTimeout(() => window.api.closeModal(), 1500);
    } catch (err) {
      setStatus('Import failed: ' + err.message, 'error');
      btnImport.disabled = false;
    }
  }
});

document.getElementById('btn-cancel').addEventListener('click', () => window.api.closeModal());
