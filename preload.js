const { contextBridge, ipcRenderer, webUtils } = require('electron');

// ── Drag-and-drop: handle in preload so File object is NOT cloned ─────────────
// contextBridge clones File objects, stripping the internal path — we must call
// webUtils.getPathForFile() here, before any cloning, then send just the string.
window.addEventListener('drop', (e) => {
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || files.length === 0) return;

  const filePaths = [];
  for (const file of files) {
    try {
      const p = webUtils.getPathForFile(file);
      if (p) filePaths.push(p);
    } catch (err) {
      console.error('[preload drop] error:', err.message);
    }
  }
  if (filePaths.length === 0) return;
  console.log('[preload drop] resolved paths:', filePaths);

  const overlay = document.getElementById('drop-overlay');
  const addToExistMode = overlay && overlay.classList.contains('fade-back');

  // In add-to-existing mode: only act if dropped on a card (single file only)
  if (addToExistMode) {
    const card = e.target && e.target.closest && e.target.closest('.asset-card[data-asset-id]');
    if (card && card.dataset.assetId) {
      ipcRenderer.invoke('add-file-to-asset', { assetId: card.dataset.assetId, filePath: filePaths[0] });
    }
    // Drop anywhere else in add-to-existing mode → do nothing
    return;
  }

  // Normal mode: open import modal (skip if dropped on the right zone)
  const onExistingZone = e.target && e.target.closest && e.target.closest('#drop-zone-existing');
  if (!onExistingZone) {
    if (filePaths.length === 1) {
      ipcRenderer.invoke('open-import-modal', filePaths[0]);
    } else {
      ipcRenderer.invoke('open-import-modal', { filePaths });
    }
  }
}, true); // capture phase — fires before renderer handlers

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getReleaseNotes: () => ipcRenderer.invoke('get-release-notes'),
  acknowledgeReleaseNotes: () => ipcRenderer.invoke('acknowledge-release-notes'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  getAssets: () => ipcRenderer.invoke('get-assets'),
  scrapeImages: (url) => ipcRenderer.invoke('scrape-images', url),
  waitForFile: (opts) => ipcRenderer.invoke('wait-for-file', opts),
  importAsset: (opts) => ipcRenderer.invoke('import-asset', opts),
  openAssetFolder: (assetId) => ipcRenderer.invoke('open-asset-folder', assetId),
  getUnityProjects: () => ipcRenderer.invoke('get-unity-projects'),
  focusUnityProject: (projectPath) => ipcRenderer.invoke('focus-unity-project', projectPath),
  getUnityImportEntries: (assetId) => ipcRenderer.invoke('get-unity-import-entries', assetId),
  importToUnity: (assetId, projectPath, selections) => ipcRenderer.invoke('import-to-unity', { assetId, projectPath, selections }),
  revealUnityCompanion: () => ipcRenderer.invoke('reveal-unity-companion'),
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
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  addFileToAsset: (assetId, filePath) => ipcRenderer.invoke('add-file-to-asset', { assetId, filePath }),
  setWindowTitle: (suffix) => ipcRenderer.invoke('set-window-title', suffix),
  getSchemeStatus: () => ipcRenderer.invoke('get-scheme-status'),
  setScheme: (scheme, enabled) => ipcRenderer.invoke('set-scheme', { scheme, enabled }),
  closeModal: () => ipcRenderer.send('close-modal'),
  refreshLibrary: (assetId) => ipcRenderer.send('refresh-library', assetId ? { assetId } : {}),
  onImportData: (cb) => ipcRenderer.on('import-data', (event, data) => cb(data)),
  onModalFileDetected: (cb) => ipcRenderer.on('modal-file-detected', (event, data) => cb(data)),
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
  // Library Scanner
  scannerScan: (folderPath) => ipcRenderer.invoke('scanner-scan', folderPath),
  scannerCancel: () => ipcRenderer.invoke('scanner-cancel'),
  scannerImportAsset: (opts) => ipcRenderer.invoke('scanner-import-asset', opts),
  scannerGetResults: () => ipcRenderer.invoke('scanner-get-results'),
  scannerSaveResults: (results) => ipcRenderer.invoke('scanner-save-results', results),
  scannerClearResults: () => ipcRenderer.invoke('scanner-clear-results'),
  onScannerProgress: (cb) => ipcRenderer.on('scanner-progress', (event, data) => cb(data)),
  // Malware scanning
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  malwareScanNow: (assetIds) => ipcRenderer.invoke('malware-scan-now', assetIds),
  malwareScanAll: () => ipcRenderer.invoke('malware-scan-all'),
  malwareMarkSafe: (assetId) => ipcRenderer.invoke('malware-mark-safe', assetId),
  malwareMarkUnsafe: (assetId) => ipcRenderer.invoke('malware-mark-unsafe', assetId),
  onMalwareScanProgress: (cb) => ipcRenderer.on('malware-scan-progress', (event, data) => cb(data)),
  onMalwareScanFlagged: (cb) => ipcRenderer.on('malware-scan-flagged', (event, data) => cb(data)),
});
