const { contextBridge, ipcRenderer, webUtils } = require('electron');

window.addEventListener('drop', (e) => {
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  const filePaths = [...files].map(f => { try { return webUtils.getPathForFile(f); } catch (_) { return null; } }).filter(Boolean);
  if (filePaths.length) ipcRenderer.invoke('open-import-modal', filePaths.length === 1 ? filePaths[0] : { filePaths });
}, true);

const on = (channel, cb) => {
  const listener = (_event, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  getAllTags: () => ipcRenderer.invoke('get-all-tags'),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  scrapeImages: url => ipcRenderer.invoke('scrape-images', url),
  updateAsset: opts => ipcRenderer.invoke('update-asset', opts),
  importAsset: opts => ipcRenderer.invoke('import-asset', opts),
  addFileToAsset: (assetId, filePath) => ipcRenderer.invoke('add-file-to-asset', { assetId, filePath }),
  getAssets: () => ipcRenderer.invoke('get-assets'),
  closeModal: () => ipcRenderer.send('close-modal'),
  refreshLibrary: assetId => ipcRenderer.send('refresh-library', assetId ? { assetId } : {}),
  onImportData: cb => on('import-data', cb),
  onModalFileDetected: cb => on('modal-file-detected', cb),
});
