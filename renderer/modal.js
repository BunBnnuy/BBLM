let resolvedFilePath = null;
let selectedImageUrl = null;

const originInput = document.getElementById('origin-url');
const nameInput = document.getElementById('asset-name');
const fileInput = document.getElementById('file-name');
const statusEl = document.getElementById('status');
const imageSection = document.getElementById('image-section');
const imageGrid = document.getElementById('image-grid');
const btnImport = document.getElementById('btn-import');

function setStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + type;
}

function clearStatus() {
  statusEl.className = 'status';
}

// Pre-fill data sent from the protocol handler or downloads monitor
window.api.onImportData((data) => {
  if (data.originUrl) originInput.value = data.originUrl;
  if (data.fileName) fileInput.value = data.fileName;
  if (data.originUrl) autoFillName(data.originUrl);

  // When triggered by the monitor the file is already downloaded
  if (data.filePath) {
    resolvedFilePath = data.filePath;
    setStatus('✔ File ready: ' + data.filePath, 'success');
    checkReady();
    // Auto-name from filename when no origin URL is known yet
    if (!data.originUrl && data.fileName) {
      const slug = data.fileName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      nameInput.value = slug.charAt(0).toUpperCase() + slug.slice(1);
    }
  }
});

function autoFillName(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      const slug = parts[parts.length - 1]
        .replace(/\.[^.]+$/, '')   // strip extension
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
  imageSection.style.display = 'none';
  imageGrid.innerHTML = '';
  selectedImageUrl = null;

  const result = await window.api.scrapeImages(url);
  if (result.error) return setStatus('Error: ' + result.error, 'error');

  // Always set name from scraped page title
  if (result.name) {
    nameInput.value = result.name;
  }

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


function checkReady() {
  btnImport.disabled = !(resolvedFilePath);
}

// ── Import ──
document.getElementById('btn-import').addEventListener('click', async () => {
  const originUrl = originInput.value.trim();
  const assetName = nameInput.value.trim();

  if (!originUrl) return setStatus('Origin URL is required.', 'error');
  if (!resolvedFilePath) return setStatus('No file resolved yet. The downloads monitor will set this automatically.', 'error');

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
});

document.getElementById('btn-cancel').addEventListener('click', () => window.api.closeModal());
