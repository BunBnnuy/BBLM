const { contextBridge, ipcRenderer, webUtils } = require('electron');

// ── Drag-and-drop: handle in preload so File object is NOT cloned ─────────────
// contextBridge clones File objects, stripping the internal path — we must call
// webUtils.getPathForFile() here, before any cloning, then send just the string.
window.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (!file) return;
  try {
    const filePath = webUtils.getPathForFile(file);
    console.log('[preload drop] resolved path:', filePath);
    if (filePath) ipcRenderer.invoke('open-import-modal', filePath);
  } catch (err) {
    console.error('[preload drop] error:', err.message);
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
  setWindowTitle: (suffix) => ipcRenderer.invoke('set-window-title', suffix),
  getSchemeStatus: () => ipcRenderer.invoke('get-scheme-status'),
  setScheme: (scheme, enabled) => ipcRenderer.invoke('set-scheme', { scheme, enabled }),
  closeModal: () => ipcRenderer.send('close-modal'),
  refreshLibrary: () => ipcRenderer.send('refresh-library'),
  onImportData: (cb) => ipcRenderer.on('import-data', (event, data) => cb(data)),
  onRefreshLibrary: (cb) => ipcRenderer.on('refresh-library', () => cb()),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (event, data) => cb(data)),
  onAssetDownloadProgress: (cb) => ipcRenderer.on('asset-download-progress', (event, data) => cb(data)),
  getQueue: () => ipcRenderer.invoke('get-queue'),
  cancelQueueItem: (id) => ipcRenderer.invoke('cancel-queue-item', id),
  onQueueUpdate: (cb) => ipcRenderer.on('queue-update', (event, data) => cb(data)),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getAllTags: () => ipcRenderer.invoke('get-all-tags'),
  setAssetTags: (assetId, tags) => ipcRenderer.invoke('set-asset-tags', { assetId, tags }),
});
