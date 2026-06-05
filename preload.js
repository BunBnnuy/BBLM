const { contextBridge, ipcRenderer } = require('electron');

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
  closeModal: () => ipcRenderer.send('close-modal'),
  refreshLibrary: () => ipcRenderer.send('refresh-library'),
  onImportData: (cb) => ipcRenderer.on('import-data', (event, data) => cb(data)),
  onRefreshLibrary: (cb) => ipcRenderer.on('refresh-library', () => cb()),
});
