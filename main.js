const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { DownloadsMonitor } = require('./src/downloadsMonitor');

const store = new Store();
const monitor = new DownloadsMonitor(onFileDetected);

const gotTheLock = app.requestSingleInstanceLock();

let mainWindow = null;
let modalWindow = null;
let tray = null;

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createTray();
    createMainWindow();

    // Start monitor if it was enabled on last run
    if (store.get('monitorEnabled', false)) {
      monitor.start(store.get('downloadsFolder', app.getPath('downloads')));
    }
  });

  app.on('before-quit', () => { app.isQuitting = true; });
  app.on('quit', () => monitor.stop());
}

const ICON = path.join(__dirname, 'assets', 'icon.png');

function createTray() {
  tray = new Tray(ICON);
  tray.setToolTip("BB's LibMan");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

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

  // Minimize to tray instead of taskbar
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });

  // Hide to tray on close unless app is actually quitting
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

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
    mainWindow.show();
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
  boothEnabled: store.get('boothEnabled', false),
  boothDownloadsFolder: store.get('boothDownloadsFolder', ''),
}));

ipcMain.handle('get-booth-items', () => {
  const enabled = store.get('boothEnabled', false);
  console.log('[Booth] enabled:', enabled);
  if (!enabled) return [];

  // Resolve path: %AppData%/Roaming/pm.booth.library-manager/data.db
  const roamingDir = path.dirname(app.getPath('userData')); // …/Roaming
  const boothDb = path.join(roamingDir, 'pm.booth.library-manager', 'data.db');
  console.log('[Booth] db path:', boothDb);

  try {
    const initSqlJs = require('sql.js');
    const dbBuffer = fs.readFileSync(boothDb);

    return initSqlJs().then(SQL => {
      const db = new SQL.Database(dbBuffer);
      const stmt = db.prepare('SELECT id, name, thumbnail_url, updated_at FROM booth_items');
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      db.close();

      console.log('[Booth] rows fetched:', rows.length);
      console.log('[Booth] first 3 rows:', JSON.stringify(rows.slice(0, 3), null, 2));

      const boothDownloadsFolder = store.get('boothDownloadsFolder', '');
      return rows.map(r => {
        const folderName = `b${r.id}`;
        const localFolder = boothDownloadsFolder
          ? path.join(boothDownloadsFolder, folderName)
          : null;
        return {
          boothId: String(r.id),
          name: r.name || '',
          thumbnailUrl: r.thumbnail_url || '',
          importedAt: r.updated_at || '',
          localFolder: localFolder || '',
          source: 'booth',
        };
      });
    });
  } catch (err) {
    console.error('[Booth] error:', err.message);
    return { error: err.message };
  }
});

ipcMain.handle('set-config', (event, config) => {
  if (config.rootFolder !== undefined) store.set('rootFolder', config.rootFolder);
  if (config.watchedDomains !== undefined) store.set('watchedDomains', config.watchedDomains);
  if (config.downloadsFolder !== undefined) store.set('downloadsFolder', config.downloadsFolder);
  if (config.monitorEnabled !== undefined) store.set('monitorEnabled', config.monitorEnabled);
  if (config.boothEnabled !== undefined) store.set('boothEnabled', config.boothEnabled);
  if (config.boothDownloadsFolder !== undefined) store.set('boothDownloadsFolder', config.boothDownloadsFolder);
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

ipcMain.handle('open-booth-folder', (event, localFolder) => {
  if (localFolder && fs.existsSync(localFolder)) {
    shell.openPath(localFolder);
  }
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
