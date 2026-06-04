const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { DownloadsMonitor } = require('./src/downloadsMonitor');

const store = new Store();
const monitor = new DownloadsMonitor(onFileDetected);

const gotTheLock = app.requestSingleInstanceLock();

let mainWindow = null;
let modalWindow = null;

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createMainWindow();

    // Start monitor if it was enabled on last run
    if (store.get('monitorEnabled', false)) {
      monitor.start(store.get('downloadsFolder', app.getPath('downloads')));
    }
  });

  app.on('quit', () => monitor.stop());
}

const ICON = path.join(__dirname, 'assets', 'icon.png');

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "BB's LibMan",
    show: false,
  });

  mainWindow.loadFile('renderer/index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  if (process.argv.includes('--inspect') || process.argv.find(a => a.startsWith('--inspect='))) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createModalWindow(importData) {
  if (modalWindow) {
    modalWindow.focus();
    return;
  }

  modalWindow = new BrowserWindow({
    width: 720,
    height: 640,
    resizable: false,
    modal: false,
    parent: mainWindow || undefined,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Import Asset',
    show: false,
  });

  modalWindow.loadFile('renderer/modal.html');
  modalWindow.once('ready-to-show', () => {
    modalWindow.show();
    modalWindow.webContents.send('import-data', importData);
  });
  modalWindow.on('closed', () => { modalWindow = null; });
}

// ── Downloads monitor callback ────────────────────────────────────────────────

function onFileDetected(filePath) {
  const fileName = path.basename(filePath);

  // Open the modal immediately
  createModalWindow({ originUrl: '', fileName, filePath });
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }

  // Also fire a system notification so the user notices if the window is behind
  const notif = new Notification({
    title: "BB's LibMan — New Asset Downloaded",
    body: `"${fileName}" is ready to import.`,
    icon: ICON,
    silent: false,
  });
  notif.on('click', () => {
    if (modalWindow) { modalWindow.restore(); modalWindow.focus(); }
  });
  notif.show();
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-config', () => ({
  rootFolder: store.get('rootFolder', ''),
  watchedDomains: store.get('watchedDomains', []),
  downloadsFolder: store.get('downloadsFolder', app.getPath('downloads')),
  monitorEnabled: store.get('monitorEnabled', false),
}));

ipcMain.handle('set-config', (event, config) => {
  if (config.rootFolder !== undefined) store.set('rootFolder', config.rootFolder);
  if (config.watchedDomains !== undefined) store.set('watchedDomains', config.watchedDomains);
  if (config.downloadsFolder !== undefined) store.set('downloadsFolder', config.downloadsFolder);
  if (config.monitorEnabled !== undefined) store.set('monitorEnabled', config.monitorEnabled);
  return true;
});

ipcMain.handle('set-monitor', (event, enabled) => {
  store.set('monitorEnabled', enabled);
  const downloadsFolder = store.get('downloadsFolder', app.getPath('downloads'));
  if (enabled) {
    monitor.start(downloadsFolder);
  } else {
    monitor.stop();
  }
  return enabled;
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('get-assets', () => {
  const { getAssets } = require('./src/assetManager');
  return getAssets(store);
});

ipcMain.handle('scrape-images', async (event, originUrl) => {
  const { scrapeImages } = require('./src/scraper');
  return await scrapeImages(originUrl);
});

ipcMain.handle('wait-for-file', async (event, { fileName, downloadsFolder }) => {
  const { waitForFile } = require('./src/fileWatcher');
  return await waitForFile(fileName, downloadsFolder);
});

ipcMain.handle('import-asset', async (event, { originUrl, filePath, selectedImageUrl, assetName }) => {
  const { importAsset } = require('./src/assetManager');
  return await importAsset({ originUrl, filePath, selectedImageUrl, assetName, store });
});

ipcMain.handle('open-asset-folder', (event, assetId) => {
  const rootFolder = store.get('rootFolder', '');
  const assetPath = path.join(rootFolder, assetId);
  if (fs.existsSync(assetPath)) shell.openPath(assetPath);
});

ipcMain.on('close-modal', () => {
  if (modalWindow) modalWindow.close();
});

ipcMain.on('refresh-library', () => {
  if (mainWindow) mainWindow.webContents.send('refresh-library');
});
