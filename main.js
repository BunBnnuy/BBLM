const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Tray, Menu } = require('electron');
process.on('uncaughtException', err => console.error('[CRASH]', err));
process.on('unhandledRejection', err => console.error('[UNHANDLED REJECTION]', err));
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { DownloadsMonitor } = require('./src/downloadsMonitor');

const store = new Store();
const monitor = new DownloadsMonitor(onFileDetected);

console.log('[main] starting, gotTheLock check...');
const gotTheLock = app.requestSingleInstanceLock();
console.log('[main] gotTheLock:', gotTheLock);

let mainWindow = null;
let modalWindow = null;
let tray = null;

const ICON = path.join(__dirname, 'assets', 'icon.png');

function handleUrl(url) {
  if (!url) return;
  console.log('[URL scheme] received:', url);

  if (url.startsWith('vroid.closet://') || url.startsWith('booth-library-manager://')) {
    handleBoothDownloadUrl(url);
  }
}

async function handleBoothDownloadUrl(url) {
  console.log('[booth-download] handling:', url);

  try {
    // Normalize to a parseable URL by replacing the custom scheme with https://
    const withProto = url
      .replace('vroid.closet://', 'https://vroid.closet/')
      .replace('booth-library-manager://', 'https://booth-library-manager/');
    const parsed = new URL(withProto);
    const params = parsed.searchParams;

    const encodedDlUrl = params.get('dlurl');
    const itemId       = params.get('item_id');
    const fileName     = params.get('downloadable_filename') || 'download.zip';

    if (!encodedDlUrl) {
      console.error('[booth-download] missing dlurl parameter');
      return;
    }

    const dlUrl    = decodeURIComponent(encodedDlUrl);
    const originUrl = itemId ? `https://booth.pm/en/items/${itemId}` : '';

    console.log('[booth-download] download URL:', dlUrl);
    console.log('[booth-download] origin URL:', originUrl);
    console.log('[booth-download] filename:', fileName);

    // Use root folder from settings for temp downloads; fall back to userData
    const rootFolder = store.get('rootFolder', '');
    const tmpDir = rootFolder && fs.existsSync(rootFolder)
      ? path.join(rootFolder, '_temp_downloads')
      : path.join(app.getPath('userData'), 'downloads');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    console.log('[booth-download] temp dir:', tmpDir);

    const destPath = path.join(tmpDir, fileName);

    // Notify the user that the download has started
    const notif = new Notification({
      title: "BB's LibMan — Downloading",
      body: `Downloading "${fileName}"…`,
      icon: ICON,
      silent: true,
    });
    notif.show();

    // Bring main window into view
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('download-progress', { itemId, percent: 0, done: false });
    }

    // Progress-aware download
    await downloadWithProgress(dlUrl, destPath, itemId);

    console.log('[booth-download] download complete:', destPath);

    // Hide progress bar
    if (mainWindow) mainWindow.webContents.send('download-progress', { itemId, percent: 100, done: true });

    // Open import modal with the downloaded file
    createModalWindow({ originUrl, fileName, filePath: destPath });
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }

  } catch (err) {
    console.error('[booth-download] error:', err.message);
    new Notification({
      title: "BB's LibMan — Download Failed",
      body: err.message,
      icon: ICON,
      silent: false,
    }).show();
  }
}

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    // On Windows the URL is passed as the last command-line argument
    const url = argv.find(arg => arg.startsWith('booth-library-manager://') || arg.startsWith('BunsLM://') || arg.startsWith('vroid.closet://'));
    if (url) handleUrl(url);

    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createTray();
    createMainWindow();

    // Handle URL if app was cold-launched via a scheme (Windows passes it in argv)
    const url = process.argv.find(arg => arg.startsWith('booth-library-manager://') || arg.startsWith('BunsLM://') || arg.startsWith('vroid.closet://'));
    if (url) handleUrl(url);

    // Start monitor if it was enabled on last run
    if (store.get('monitorEnabled', false)) {
      monitor.start(store.get('downloadsFolder', app.getPath('downloads')));
    }
  });

  app.on('before-quit', () => { app.isQuitting = true; });
  app.on('quit', () => monitor.stop());
}

function downloadWithProgress(url, destPath, itemId) {
  const https = require('https');
  const http  = require('http');

  function doDownload(url) {
    return new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? https : http;
      const options = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } };

      proto.get(url, options, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('/')
            ? new URL(res.headers.location, url).href
            : res.headers.location;
          return doDownload(redirectUrl).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const file = fs.createWriteStream(destPath);

        res.on('data', chunk => {
          received += chunk.length;
          if (total > 0 && mainWindow) {
            const percent = Math.round((received / total) * 100);
            mainWindow.webContents.send('download-progress', { itemId, percent, done: false });
          }
        });

        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        res.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
      }).on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
    });
  }

  return doDownload(url);
}

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
      const hidden = store.get('hiddenAssets', []);

      return rows
        .filter(r => !hidden.includes('booth:' + String(r.id)))
        .map(r => {
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
  const hidden = store.get('hiddenAssets', []);
  return getAssets(store).filter(a => !hidden.includes(a.id));
});

ipcMain.handle('hide-asset', (event, assetId) => {
  const hidden = store.get('hiddenAssets', []);
  if (!hidden.includes(assetId)) store.set('hiddenAssets', [...hidden, assetId]);
  return true;
});

ipcMain.handle('unhide-asset', (event, assetId) => {
  const hidden = store.get('hiddenAssets', []);
  store.set('hiddenAssets', hidden.filter(id => id !== assetId));
  return true;
});

ipcMain.handle('get-hidden-assets', () => {
  const { getAssets } = require('./src/assetManager');
  const hidden = store.get('hiddenAssets', []);

  const localHidden = getAssets(store).filter(a => hidden.includes(a.id));

  // Include hidden BLM items
  const boothHiddenIds = hidden
    .filter(id => id.startsWith('booth:'))
    .map(id => id.slice(6)); // strip 'booth:' prefix

  if (!store.get('boothEnabled', false) || boothHiddenIds.length === 0) {
    return [...localHidden];
  }

  try {
    const initSqlJs = require('sql.js');
    const roamingDir = path.dirname(app.getPath('userData'));
    const boothDb = path.join(roamingDir, 'pm.booth.library-manager', 'data.db');
    const dbBuffer = fs.readFileSync(boothDb);

    return initSqlJs().then(SQL => {
      const db = new SQL.Database(dbBuffer);
      const placeholders = boothHiddenIds.map(() => '?').join(',');
      const stmt = db.prepare(
        `SELECT id, name, thumbnail_url, updated_at FROM booth_items WHERE CAST(id AS TEXT) IN (${placeholders})`
      );
      stmt.bind(boothHiddenIds);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      db.close();

      const boothDownloadsFolder = store.get('boothDownloadsFolder', '');
      const boothHidden = rows.map(r => ({
        id: 'booth:' + String(r.id),
        boothId: String(r.id),
        name: r.name || '',
        thumbnailUrl: r.thumbnail_url || '',
        thumbnailPath: null,
        importedAt: r.updated_at || '',
        localFolder: boothDownloadsFolder ? path.join(boothDownloadsFolder, `b${r.id}`) : '',
        source: 'booth',
      }));

      return [...localHidden, ...boothHidden];
    });
  } catch (err) {
    console.error('[Booth] get-hidden-assets error:', err.message);
    return [...localHidden];
  }
});

ipcMain.handle('delete-asset', (event, assetId) => {
  const { deleteAsset } = require('./src/assetManager');
  // Also remove from hidden list if present
  const hidden = store.get('hiddenAssets', []);
  store.set('hiddenAssets', hidden.filter(id => id !== assetId));
  return deleteAsset({ assetId, store });
});

ipcMain.handle('update-asset', async (event, opts) => {
  const { updateAsset } = require('./src/assetManager');
  return await updateAsset({ ...opts, store });
});

ipcMain.handle('open-edit-modal', (event, asset) => {
  createModalWindow({ ...asset, mode: 'edit' });
});

// ── URL scheme registration ───────────────────────────────────────────────────
const URL_SCHEMES = ['booth-library-manager', 'BunsLM', 'vroid.closet'];


ipcMain.handle('set-scheme', (event, { scheme, enabled }) => {
  if (!URL_SCHEMES.includes(scheme)) return false;
  // In dev mode electron.exe is the executable — we must pass the app path as an
  // extra argument so Windows knows which project to open.
  const isDev = !app.isPackaged;
  const args = isDev ? [path.resolve(process.argv[1])] : [];
  if (enabled) {
    app.setAsDefaultProtocolClient(scheme, process.execPath, args);
  } else {
    app.removeAsDefaultProtocolClient(scheme, process.execPath, args);
  }
  const registered = app.isDefaultProtocolClient(scheme, process.execPath, args);
  console.log(`[URL scheme] ${scheme} registered: ${registered}`);
  return registered;
});

ipcMain.handle('get-scheme-status', () => {
  const isDev = !app.isPackaged;
  const args = isDev ? [path.resolve(process.argv[1])] : [];
  const result = {};
  for (const scheme of URL_SCHEMES) {
    result[scheme] = app.isDefaultProtocolClient(scheme, process.execPath, args);
  }
  return result;
});

ipcMain.handle('open-import-modal', (event, filePath) => {
  console.log('[open-import-modal] called with:', filePath);
  const fileName = path.basename(filePath);
  createModalWindow({ originUrl: '', fileName, filePath });
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

ipcMain.handle('open-external', (event, url) => shell.openExternal(url));

ipcMain.on('close-modal', () => {
  if (modalWindow) modalWindow.close();
});

ipcMain.on('refresh-library', () => {
  if (mainWindow) mainWindow.webContents.send('refresh-library');
});
