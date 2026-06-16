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
let freeItemsTimer = null;
let freeItemsScanCancelled = false;

const ICON = path.join(__dirname, 'assets', 'icon.png');

// ── Download Queue ────────────────────────────────────────────────────────────
class DownloadQueue {
  constructor() {
    this.queue   = []; // pending items
    this.active  = null; // currently processing item
    this.running = false;
    this._nextId = 1;
  }

  _notify() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('queue-update', this.status());
    }
  }

  status() {
    return {
      active: this.active ? { ...this.active } : null,
      pending: this.queue.map(i => ({ id: i.id, fileName: i.fileName, itemId: i.itemId })),
    };
  }

  add(job) {
    const item = { ...job, id: this._nextId++, status: 'pending', percent: 0 };
    this.queue.push(item);
    this._notify();
    this._process();
    return item.id;
  }

  cancel(id) {
    // Cancel pending item
    const idx = this.queue.findIndex(i => i.id === id);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      this._notify();
      return true;
    }
    // Cancel active item
    if (this.active && this.active.id === id) {
      this.active.cancelled = true;
      return true;
    }
    return false;
  }

  async _process() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    this.active  = this.queue.shift();
    this.active.status = 'downloading';
    this._notify();

    try {
      await this._run(this.active);
    } catch (err) {
      console.error('[queue] job failed:', err.message);
      this.active.status = 'error';
      this.active.error  = err.message;
      this._notify();
      if (mainWindow && store.get('notificationsEnabled', true)) {
        new Notification({
          title: "BB's LibMan — Download Failed",
          body: `"${this.active.fileName}": ${err.message}`,
          icon: ICON,
          silent: false,
        }).show();
      }
    } finally {
      this.active  = null;
      this.running = false;
      this._notify();
      if (this.queue.length > 0) this._process();
    }
  }

  async _run(item) {
    if (item.cancelled) return;

    const { dlUrl, fileName, itemId, originUrl } = item;

    const rootFolder = store.get('rootFolder', '');
    const tmpDir = rootFolder && fs.existsSync(rootFolder)
      ? path.join(rootFolder, '_temp_downloads')
      : path.join(app.getPath('userData'), 'downloads');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const destPath = path.join(tmpDir, fileName);

    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setTitle(`BB's LibMan — Fetching metadata…`);
    }

    // Phase 1: scrape metadata + create asset shell
    const { scrapePageMeta } = require('./src/scraper');
    const { createAssetShell, finalizeAssetDownload } = require('./src/assetManager');

    let assetName = fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    let tags = [];
    let selectedImageUrl = null;

    if (originUrl) {
      try {
        const scraped = await scrapePageMeta(originUrl);
        if (scraped.name)   assetName        = scraped.name;
        if (scraped.tags?.length)  tags        = scraped.tags;
        if (scraped.images?.length) selectedImageUrl = scraped.images[0].url;
      } catch (err) {
        console.warn('[queue] scrape failed:', err.message);
      }
    }

    if (item.cancelled) return;

    const shell = await createAssetShell({ originUrl, assetName, selectedImageUrl, tags, store });
    if (mainWindow) mainWindow.webContents.send('refresh-library', { assetId: shell.assetId });

    if (item.cancelled) {
      // Clean up shell if cancelled before download
      const { deleteAsset } = require('./src/assetManager');
      deleteAsset({ assetId: shell.assetId, store });
      return;
    }

    // Phase 2: download file
    if (mainWindow) mainWindow.setTitle(`BB's LibMan — Downloading ${fileName}…`);

    await downloadWithProgress(dlUrl, destPath, itemId, 0, (percent) => {
      item.percent = percent;
      this._notify();
      if (mainWindow) mainWindow.webContents.send('asset-download-progress', { assetId: shell.assetId, percent });
    });

    finalizeAssetDownload({ assetId: shell.assetId, filePath: destPath, store });

    // If this came from the free items scraper, mark it as pending review
    if (item.freeItemPending) {
      const rootFolder = store.get('rootFolder', '');
      const metaPath = path.join(rootFolder, shell.assetId, 'meta.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        meta.freeItemPending = true;
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      }
      const freeEntry = {
        assetId: shell.assetId,
        name: shell.meta.name,
        thumbnailPath: shell.meta.thumbnail
          ? path.join(store.get('rootFolder', ''), shell.assetId, shell.meta.thumbnail)
          : null,
        boothUrl: originUrl,
        downloadedAt: new Date().toISOString(),
      };
      const existing = store.get('downloadedFreeItems', []);
      if (!existing.find(e => e.assetId === shell.assetId)) {
        store.set('downloadedFreeItems', [...existing, freeEntry]);
      }
      if (mainWindow) mainWindow.webContents.send('free-item-downloaded', freeEntry);
    }

    if (mainWindow) {
      mainWindow.webContents.send('asset-download-progress', { assetId: shell.assetId, percent: 100, done: true });
      if (!item.freeItemPending) mainWindow.webContents.send('refresh-library', { assetId: shell.assetId });
      mainWindow.setTitle(`BB's LibMan`);
    }

    if (store.get('notificationsEnabled', true)) {
      new Notification({
        title: "BB's LibMan — Asset Ready",
        body: `"${shell.meta.name}" has been added to your library.`,
        icon: ICON,
        silent: false,
      }).show();
    }
  }
}

const downloadQueue = new DownloadQueue();

function handleUrl(url) {
  if (!url) return;
  console.log('[URL scheme] received:', url);

  if (url.startsWith('vroid.closet://') || url.startsWith('booth-library-manager://')) {
    handleBoothDownloadUrl(url);
  }
}

function handleBoothDownloadUrl(url, freeItemPending = false) {
  console.log('[booth-download] queuing:', url);

  const withProto = url
    .replace('vroid.closet://', 'https://vroid.closet/')
    .replace('booth-library-manager://', 'https://booth-library-manager/');

  let dlUrl, itemId, fileName;
  try {
    const params = new URL(withProto).searchParams;
    dlUrl    = params.get('dlurl');
    itemId   = params.get('item_id');
    fileName = params.get('downloadable_filename') || 'download.zip';
  } catch (err) {
    console.error('[booth-download] failed to parse URL:', err.message);
    return;
  }

  if (!dlUrl) { console.error('[booth-download] missing dlurl'); return; }

  const originUrl = itemId ? `https://booth.pm/en/items/${itemId}` : '';
  const queueId = downloadQueue.add({ dlUrl, fileName, itemId, originUrl, freeItemPending });
  console.log(`[booth-download] added to queue as #${queueId} (${downloadQueue.queue.length + 1} total)`);
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

    // Schedule free items auto-scan if interval is set
    scheduleFreeItemsInterval();
  });

  app.on('before-quit', () => { app.isQuitting = true; });
  app.on('quit', () => monitor.stop());
}

function downloadWithProgress(url, destPath, itemId, redirectCount = 0, onProgress = null) {
  const https = require('https');
  const http  = require('http');

  if (redirectCount > 10) return Promise.reject(new Error('Too many redirects'));

  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/octet-stream, application/zip, application/x-zip-compressed, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://booth.pm/',
      },
    };

    proto.get(url, options, res => {
      const { statusCode, headers } = res;
      const contentType = headers['content-type'] || '';
      const location    = headers['location'] || '';

      console.log(`[download] ${statusCode} ${url.slice(0, 80)}…`);
      console.log(`[download] content-type: ${contentType}`);
      console.log(`[download] content-length: ${headers['content-length'] || 'unknown'}`);

      // Follow redirects
      if (statusCode >= 300 && statusCode < 400 && location) {
        res.resume();
        const redirectUrl = location.startsWith('/') ? new URL(location, url).href : location;
        // Reject if redirect leads to auth/login page
        if (/accounts\.|login|signin|auth/i.test(redirectUrl)) {
          return reject(new Error('Download URL requires authentication — the link may have expired. Please re-download from Booth.'));
        }
        return downloadWithProgress(redirectUrl, destPath, itemId, redirectCount + 1, onProgress).then(resolve).catch(reject);
      }

      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode} — download failed`));
      }

      // Reject HTML/XML responses (error pages, login pages)
      if (/text\/html|application\/xml|text\/xml/i.test(contentType)) {
        // Read first 512 bytes to include in the error
        let snippet = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { snippet += chunk; });
        res.on('end', () => {
          console.error('[download] received HTML/XML instead of file:', snippet.slice(0, 200));
          reject(new Error('Server returned an error page instead of the file. The download link may have expired — please re-download from Booth.'));
        });
        return;
      }

      const total = parseInt(headers['content-length'] || '0', 10);
      let received = 0;
      const file = fs.createWriteStream(destPath);

      res.on('data', chunk => {
        received += chunk.length;
        if (total > 0) {
          const percent = Math.round((received / total) * 100);
          if (onProgress) onProgress(percent);
        }
      });

      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          const fileSize = fs.statSync(destPath).size;
          console.log(`[download] saved ${fileSize} bytes to ${destPath}`);
          if (fileSize < 1024) {
            fs.unlink(destPath, () => {});
            return reject(new Error(`Downloaded file is suspiciously small (${fileSize} bytes). The link may have expired.`));
          }
          resolve();
        });
      });
      res.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
    }).on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
  });
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
    autoHideMenuBar: true,
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

  if (modalWindow && !modalWindow.isDestroyed()) {
    // Modal already open — push the new file into it
    modalWindow.webContents.send('modal-file-detected', { filePath, fileName });
    modalWindow.restore();
    modalWindow.focus();
  } else {
    createModalWindow({ originUrl: '', fileName, filePath });
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  }

  if (store.get('notificationsEnabled', true)) {
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
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-config', () => ({
  rootFolder: store.get('rootFolder', ''),
  watchedDomains: store.get('watchedDomains', []),
  downloadsFolder: store.get('downloadsFolder', app.getPath('downloads')),
  monitorEnabled: store.get('monitorEnabled', false),
  notificationsEnabled: store.get('notificationsEnabled', true),
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

      // Fetch items
      const stmt = db.prepare('SELECT id, name, thumbnail_url, updated_at FROM booth_items');
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();

      // Fetch all tag relations in one query and group by item id
      const tagMap = {};
      const tagStmt = db.prepare('SELECT booth_item_id, tag FROM booth_item_tag_relations');
      while (tagStmt.step()) {
        const row = tagStmt.getAsObject();
        const id = String(row.booth_item_id);
        if (!tagMap[id]) tagMap[id] = [];
        tagMap[id].push(row.tag);
      }
      tagStmt.free();
      db.close();

      console.log('[Booth] rows fetched:', rows.length);
      console.log('[Booth] first 3 rows:', JSON.stringify(rows.slice(0, 3), null, 2));

      // Register all BLM tags into the global tag list
      const { registerTags } = require('./src/assetManager');
      const allBlmTags = Object.values(tagMap).flat();
      if (allBlmTags.length) registerTags(allBlmTags, store);

      const boothDownloadsFolder = store.get('boothDownloadsFolder', '');
      const hidden = store.get('hiddenAssets', []);

      return rows
        .filter(r => !hidden.includes('booth:' + String(r.id)))
        .map(r => {
          const id = String(r.id);
          const folderName = `b${r.id}`;
          const localFolder = boothDownloadsFolder
            ? path.join(boothDownloadsFolder, folderName)
            : null;
          return {
            boothId: id,
            name: r.name || '',
            thumbnailUrl: r.thumbnail_url || '',
            importedAt: r.updated_at || '',
            localFolder: localFolder || '',
            tags: tagMap[id] || [],
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
  if (config.notificationsEnabled !== undefined) store.set('notificationsEnabled', config.notificationsEnabled);
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
  return getAssets(store).filter(a => !hidden.includes(a.id) && !a.freeItemPending);
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

ipcMain.handle('add-file-to-asset', (event, { assetId, filePath }) => {
  const rootFolder = store.get('rootFolder', '');
  const assetDir   = path.join(rootFolder, assetId);
  const metaPath   = path.join(assetDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return { error: 'Asset not found' };

  const fileName = path.basename(filePath);
  const destFile = path.join(assetDir, fileName);
  try {
    fs.renameSync(filePath, destFile);
  } catch (err) {
    if (err.code === 'EXDEV') { fs.copyFileSync(filePath, destFile); fs.unlinkSync(filePath); }
    else return { error: err.message };
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (!meta.files) meta.files = [];
  if (!meta.files.includes(fileName)) meta.files.push(fileName);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return { assetId, fileName };
});

ipcMain.handle('open-import-modal', (event, arg) => {
  // arg can be a string (single file) or { filePaths: string[] } (multiple files)
  let filePaths;
  if (typeof arg === 'string') {
    filePaths = [arg];
  } else if (arg && Array.isArray(arg.filePaths)) {
    filePaths = arg.filePaths;
  } else {
    return;
  }
  console.log('[open-import-modal] called with:', filePaths);
  const fileName = path.basename(filePaths[0]);
  createModalWindow({ originUrl: '', fileName, filePath: filePaths[0], filePaths });
});

ipcMain.handle('pick-files', async () => {
  const result = await dialog.showOpenDialog(modalWindow || mainWindow || BrowserWindow.getFocusedWindow(), {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Archive & Package Files', extensions: ['zip', 'rar', '7z', 'unitypackage', 'tar', 'gz'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePaths;
});

ipcMain.handle('scrape-images', async (event, originUrl) => {
  const { scrapeImages } = require('./src/scraper');
  return await scrapeImages(originUrl);
});

ipcMain.handle('wait-for-file', async (event, { fileName, downloadsFolder }) => {
  const { waitForFile } = require('./src/fileWatcher');
  return await waitForFile(fileName, downloadsFolder);
});

ipcMain.handle('import-asset', async (event, { originUrl, filePath, selectedImageUrl, assetName, tags }) => {
  const { importAsset } = require('./src/assetManager');
  return await importAsset({ originUrl, filePath, selectedImageUrl, assetName, tags, store });
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

ipcMain.handle('set-window-title', (event, suffix) => {
  if (mainWindow) {
    mainWindow.setTitle(suffix ? `BB's LibMan — ${suffix}` : `BB's LibMan`);
  }
});

ipcMain.handle('get-all-tags', () => store.get('allTags', []));
ipcMain.handle('get-queue',      () => downloadQueue.status());
ipcMain.handle('cancel-queue-item', (event, id) => downloadQueue.cancel(id));


ipcMain.handle('set-asset-tags', (event, { assetId, tags }) => {
  const { updateAsset } = require('./src/assetManager');
  return updateAsset({ assetId, tags, store });
});

ipcMain.on('close-modal', () => {
  if (modalWindow) modalWindow.close();
});

ipcMain.on('refresh-library', (event, data) => {
  if (mainWindow) mainWindow.webContents.send('refresh-library', data || {});
});

// ── Booth Free Items ──────────────────────────────────────────────────────────

/**
 * Navigate to a Booth deeplink URL in a hidden BrowserWindow that uses a
 * persistent partition so the session survives across calls.
 * Intercepts the booth-library-manager:// redirect and queues the download.
 * If the session isn't authenticated, the window becomes visible so the user
 * can log in; after sign-in we automatically retry the deeplink.
 */
function downloadFreeItemInternal(deeplinkUrl) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 660,
      show: false,
      parent: mainWindow || undefined,
      icon: ICON,
      webPreferences: {
        partition: 'persist:booth-auth',
        nodeIntegration: false,
        contextIsolation: true,
      },
      title: 'Booth — Sign In',
      autoHideMenuBar: true,
    });

    let done = false;

    const finish = (err) => {
      if (done) return;
      done = true;
      if (!win.isDestroyed()) win.destroy();
      err ? reject(err) : resolve();
    };

    const loadDeeplink = () => {
      if (!win.isDestroyed()) win.loadURL(deeplinkUrl);
    };

    // Intercept the scheme redirect before the OS handles it
    win.webContents.on('will-redirect', (event, url) => {
      if (url.startsWith('booth-library-manager://') || url.startsWith('vroid.closet://')) {
        event.preventDefault();
        handleBoothDownloadUrl(url, false);
        finish(null);
      }
    });

    win.webContents.on('did-navigate', (event, url) => {
      if (done) return;
      const isSignIn = /\/users\/sign_in|\/login/i.test(url);
      if (isSignIn) {
        // Need credentials — show the window
        if (!win.isVisible()) win.show();
      } else if (win.isVisible() && url.includes('booth.pm')) {
        // User just logged in; retry the deeplink
        setTimeout(loadDeeplink, 400);
      }
    });

    win.on('closed', () => {
      if (!done) finish(new Error('Login window closed before download started'));
    });

    const timeoutId = setTimeout(() => finish(new Error('Booth download timed out')), 60000);
    win.on('close', () => clearTimeout(timeoutId));

    loadDeeplink();
  });
}

ipcMain.handle('download-free-item', async (event, deeplinkUrl) => {
  try {
    await downloadFreeItemInternal(deeplinkUrl);
    return { ok: true };
  } catch (err) {
    console.error('[download-free-item]', err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-library-item-ids', () => {
  const { getAssets } = require('./src/assetManager');
  return getAssets(store)
    .map(a => { const m = (a.originUrl || '').match(/\/items\/(\d+)/); return m ? parseInt(m[1], 10) : null; })
    .filter(Boolean);
});

ipcMain.handle('get-free-items-config', () => ({
  enabled: store.get('freeItemsEnabled', true),
  interval: store.get('freeItemsInterval', 6),
  maxPages: store.get('freeItemsMaxPages', 5),
}));

ipcMain.handle('set-free-items-config', (event, config) => {
  if (config.enabled !== undefined) store.set('freeItemsEnabled', config.enabled);
  if (config.interval !== undefined) store.set('freeItemsInterval', config.interval);
  if (config.maxPages !== undefined) store.set('freeItemsMaxPages', config.maxPages);
  scheduleFreeItemsInterval();
  return true;
});

ipcMain.handle('get-downloaded-free-items', () => store.get('downloadedFreeItems', []));
ipcMain.handle('get-found-free-items', () => store.get('foundFreeItems', []));

ipcMain.handle('keep-free-item', (event, assetId) => {
  const rootFolder = store.get('rootFolder', '');
  const metaPath = path.join(rootFolder, assetId, 'meta.json');
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    delete meta.freeItemPending;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }
  const items = store.get('downloadedFreeItems', []);
  store.set('downloadedFreeItems', items.filter(i => i.assetId !== assetId));
  if (mainWindow) mainWindow.webContents.send('refresh-library', { assetId });
  return true;
});

ipcMain.handle('delete-free-item', (event, assetId) => {
  const { deleteAsset } = require('./src/assetManager');
  deleteAsset({ assetId, store });
  const items = store.get('downloadedFreeItems', []);
  store.set('downloadedFreeItems', items.filter(i => i.assetId !== assetId));
  return true;
});

ipcMain.handle('start-free-scan', async () => {
  freeItemsScanCancelled = false;
  await runFreeItemsScan();
  return true;
});

ipcMain.handle('stop-free-scan', () => {
  freeItemsScanCancelled = true;
  return true;
});

async function runFreeItemsScan() {
  const { scrapeFreeItems } = require('./src/boothFreeScraper');
  const maxPages = store.get('freeItemsMaxPages', 5);

  freeItemsScanCancelled = false;

  const sendProgress = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('free-items-progress', data);
    }
  };

  sendProgress({ phase: 'started' });

  // Clear previous scan results
  store.set('foundFreeItems', []);

  try {
    const result = await scrapeFreeItems({
      maxPages,
      isCancelled: () => freeItemsScanCancelled,
      onProgress: sendProgress,
      onItem: (item) => {
        const existing = store.get('foundFreeItems', []);
        if (!existing.find(e => e.itemId === item.itemId)) {
          store.set('foundFreeItems', [...existing, item]);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('free-item-found', item);
        }
      },
    });
    sendProgress({ phase: 'done', ...result });
  } catch (err) {
    console.error('[free-scan] error:', err.message);
    sendProgress({ phase: 'error', message: err.message });
  }
}

// ── Library Scanner ───────────────────────────────────────────────────────────

let scannerCancelled = false;

function find7zip() {
  const candidates = [
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  ];
  for (const p of candidates) {
    try { fs.accessSync(p); return p; } catch {}
  }
  const { spawnSync } = require('child_process');
  try {
    const r = spawnSync('7z', ['i'], { encoding: 'utf8', timeout: 3000 });
    if (!r.error) return '7z';
  } catch {}
  return null;
}

ipcMain.handle('scanner-get-results',   () => store.get('scannerResults', []));
ipcMain.handle('scanner-save-results',  (event, results) => { store.set('scannerResults', results); return true; });
ipcMain.handle('scanner-clear-results', () => { store.set('scannerResults', []); return true; });

ipcMain.handle('scanner-import-asset', async (event, { archivePath, originUrl }) => {
  const { scrapePageMeta } = require('./src/scraper');
  const { importAsset } = require('./src/assetManager');

  let assetName = path.basename(archivePath, path.extname(archivePath)).replace(/[-_]+/g, ' ').trim();
  let tags = [];
  let selectedImageUrl = null;

  if (originUrl) {
    try {
      const scraped = await scrapePageMeta(originUrl);
      if (scraped.name)           assetName        = scraped.name;
      if (scraped.tags?.length)   tags             = scraped.tags;
      if (scraped.images?.length) selectedImageUrl = scraped.images[0].url;
    } catch (err) {
      console.warn('[scanner-import] scrape failed:', err.message);
    }
  }

  try {
    const result = await importAsset({ originUrl, filePath: archivePath, selectedImageUrl, assetName, tags, store });
    if (mainWindow) mainWindow.webContents.send('refresh-library', { assetId: result.assetId });
    return { ok: true, assetId: result.assetId, assetName: result.meta.name };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('scanner-cancel', () => {
  scannerCancelled = true;
  return true;
});

ipcMain.handle('scanner-scan', async (event, folderPath) => {
  scannerCancelled = false;
  const { spawnSync } = require('child_process');
  const os = require('os');

  const send = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scanner-progress', data);
    }
  };

  const sevenZip = find7zip();
  if (!sevenZip) {
    send({ type: 'error', message: '7-Zip not found. Please install 7-Zip from https://www.7-zip.org/' });
    return { ok: false };
  }

  const COMPRESSED_EXTS = new Set([
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
    '.unitypackage', '.nupkg', '.jar', '.whl', '.egg',
  ]);

  // Collect top-level archive files from the selected folder
  function walkFolder(dir, results = []) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
    for (const e of entries) {
      if (scannerCancelled) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walkFolder(full, results);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (COMPRESSED_EXTS.has(ext)) results.push(full);
      }
    }
    return results;
  }

  // Extract archive to a temp dir, walk contents for the first "pathname" file.
  // Returns true if a pathname was found (signals caller to stop searching).
  // rootArchive is always the original top-level file for display purposes.
  function processArchive(archivePath, rootArchive, counter) {
    if (scannerCancelled) return false;

    const tempDir = path.join(os.tmpdir(), `bblm-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      fs.mkdirSync(tempDir, { recursive: true });

      const r = spawnSync(sevenZip, ['x', archivePath, `-o${tempDir}`, '-y'], {
        maxBuffer: 200 * 1024 * 1024,
        timeout: 120000,
      });
      if (r.error) throw r.error;

      return walkExtracted(tempDir, rootArchive, counter);
    } catch (err) {
      send({ type: 'archive_error', archive: rootArchive, message: err.message });
      return false;
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }

  // Walk an extracted directory. Stops as soon as the first "pathname" is found.
  // Returns true if found, false otherwise.
  function walkExtracted(dir, rootArchive, counter) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    for (const e of entries) {
      if (scannerCancelled) return false;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (walkExtracted(full, rootArchive, counter)) return true;
      } else if (e.name === 'pathname') {
        try {
          const content = fs.readFileSync(full, 'utf8').trim();
          if (content) {
            counter.found++;
            send({ type: 'result', archive: rootArchive, content });
            return true; // first pathname found — stop
          }
        } catch {}
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (COMPRESSED_EXTS.has(ext)) {
          if (processArchive(full, rootArchive, counter)) return true;
        }
      }
    }
    return false;
  }

  send({ type: 'walking' });
  const archives = walkFolder(folderPath);
  if (scannerCancelled) { send({ type: 'cancelled' }); return { ok: false }; }

  send({ type: 'found_archives', count: archives.length });

  const counter = { found: 0 };

  for (let i = 0; i < archives.length; i++) {
    if (scannerCancelled) break;
    const archivePath = archives[i];
    send({ type: 'scanning', current: archivePath, index: i + 1, total: archives.length });
    processArchive(archivePath, archivePath, counter);
  }

  if (scannerCancelled) {
    send({ type: 'cancelled' });
  } else {
    send({ type: 'done', total: archives.length, found: counter.found });
  }

  return { ok: true };
});

function scheduleFreeItemsInterval() {
  if (freeItemsTimer) { clearTimeout(freeItemsTimer); freeItemsTimer = null; }
  if (!store.get('freeItemsEnabled', true)) return;
  const hours = store.get('freeItemsInterval', 6);
  if (!hours || hours <= 0) return;
  freeItemsTimer = setTimeout(async () => {
    await runFreeItemsScan();
    scheduleFreeItemsInterval();
  }, hours * 60 * 60 * 1000);
}
