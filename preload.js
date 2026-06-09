const { contextBridge, ipcRenderer, webUtils } = require('electron');

// ── Drag-and-drop: handle in preload so File object is NOT cloned ─────────────
// contextBridge clones File objects, stripping the internal path — we must call
// webUtils.getPathForFile() here, before any cloning, then send just the string.
window.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (!file) return;
  let filePath;
  try {
    filePath = webUtils.getPathForFile(file);
    console.log('[preload drop] resolved path:', filePath);
  } catch (err) {
    console.error('[preload drop] error:', err.message);
    return;
  }
  if (!filePath) return;

  const overlay = document.getElementById('drop-overlay');
  const addToExistMode = overlay && overlay.classList.contains('fade-back');

  // In add-to-existing mode: only act if dropped on a card
  if (addToExistMode) {
    const card = e.target && e.target.closest && e.target.closest('.asset-card[data-asset-id]');
    if (card && card.dataset.assetId) {
      ipcRenderer.invoke('add-file-to-asset', { assetId: card.dataset.assetId, filePath });
    }
    // Drop anywhere else in add-to-existing mode → do nothing
    return;
  }

  // Normal mode: open import modal (skip if dropped on the right zone)
  const onExistingZone = e.target && e.target.closest && e.target.closest('#drop-zone-existing');
  if (!onExistingZone) {
    ipcRenderer.invoke('open-import-modal', filePath);
  }
}, true); // capture phase — fires before renderer handlers

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  getAssets: () => ipcRenderer.invoke('get-assets'),
  scrapeImages: (url) => ipcRenderer.invoke('scrape-images', url),
  waitForFile: (opts) => ipcRenderer.invoke('wait-for-file', opts),
  importAsset: (opts) => ipcRenderer.invoke('import-asset', opts),
  openAssetFolder: (assetId) => ipcRenderer.invoke('open-asset-folder', assetId),
  setMonitor: (enabled) => ipcRenderer.invoke('set-monitor', enabled),
  getBoothItems: () => ipcRenderer.invoke('get-booth-items'),
  openBoothFolder: (localFolder) => ipcRenderer.invoke('open-booth-folder', localFolder),
  hideAsset: (assetId) => ipcRenderer.invoke('hide-asset', assetId),
  unhideAsset: (assetId) => ipcRenderer.invoke('unhide-asset', assetId),
  getHiddenAssets: () => ipcRenderer.invoke('get-hidden-assets'),
  deleteAsset: (assetId) => ipcRenderer.invoke('delete-asset', assetId),
  updateAsset: (opts) => ipcRenderer.invoke('update-asset', opts),
  openEditModal: (asset) => ipcRenderer.invoke('open-edit-modal', asset),
  openImportModal: (filePath) => ipcRenderer.invoke('open-import-modal', filePath),
  addFileToAsset: (assetId, filePath) => ipcRenderer.invoke('add-file-to-asset', { assetId, filePath }),
  setWindowTitle: (suffix) => ipcRenderer.invoke('set-window-title', suffix),
  getSchemeStatus: () => ipcRenderer.invoke('get-scheme-status'),
  setScheme: (scheme, enabled) => ipcRenderer.invoke('set-scheme', { scheme, enabled }),
  closeModal: () => ipcRenderer.send('close-modal'),
  refreshLibrary: (assetId) => ipcRenderer.send('refresh-library', assetId ? { assetId } : {}),
  onImportData: (cb) => ipcRenderer.on('import-data', (event, data) => cb(data)),
  onRefreshLibrary: (cb) => ipcRenderer.on('refresh-library', (event, data) => cb(data || {})),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (event, data) => cb(data)),
  onAssetDownloadProgress: (cb) => ipcRenderer.on('asset-download-progress', (event, data) => cb(data)),
  getQueue: () => ipcRenderer.invoke('get-queue'),
  cancelQueueItem: (id) => ipcRenderer.invoke('cancel-queue-item', id),
  onQueueUpdate: (cb) => ipcRenderer.on('queue-update', (event, data) => cb(data)),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getAllTags: () => ipcRenderer.invoke('get-all-tags'),
  setAssetTags: (assetId, tags) => ipcRenderer.invoke('set-asset-tags', { assetId, tags }),
  // Free Items
  getFreeItemsConfig: () => ipcRenderer.invoke('get-free-items-config'),
  setFreeItemsConfig: (config) => ipcRenderer.invoke('set-free-items-config', config),
  getDownloadedFreeItems: () => ipcRenderer.invoke('get-downloaded-free-items'),
  keepFreeItem: (assetId) => ipcRenderer.invoke('keep-free-item', assetId),
  deleteFreeItem: (assetId) => ipcRenderer.invoke('delete-free-item', assetId),
  startFreeScan: () => ipcRenderer.invoke('start-free-scan'),
  stopFreeScan: () => ipcRenderer.invoke('stop-free-scan'),
  getFoundFreeItems: () => ipcRenderer.invoke('get-found-free-items'),
  downloadFreeItem: (deeplinkUrl) => ipcRenderer.invoke('download-free-item', deeplinkUrl),
  getLibraryItemIds: () => ipcRenderer.invoke('get-library-item-ids'),
  onFreeItemsProgress: (cb) => ipcRenderer.on('free-items-progress', (event, data) => cb(data)),
  onFreeItemDownloaded: (cb) => ipcRenderer.on('free-item-downloaded', (event, data) => cb(data)),
  onFreeItemFound: (cb) => ipcRenderer.on('free-item-found', (event, data) => cb(data)),
});
