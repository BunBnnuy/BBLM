const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Tray, Menu, clipboard, powerMonitor } = require('electron');
process.on('uncaughtException', err => console.error('[CRASH]', err));
process.on('unhandledRejection', err => console.error('[UNHANDLED REJECTION]', err));
const path = require('path');
const { fileURLToPath } = require('url');
const fs = require('fs');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const logger = require('./src/logger');
const { DownloadsMonitor } = require('./src/downloadsMonitor');
const { parseDownloadProtocol, parseImportIntent } = require('./src/protocol');
const { resolveExistingAssetDir, resolveAssetFile, sanitizeExternalFilename } = require('./src/security/pathPolicy');
const { writeJsonAtomic, cleanupStaging } = require('./src/atomicFs');
const { ensureScannerUpdated } = require('./src/malwareScanner');
const { scanTargets } = require('./src/malwareScan');
const { parseReleaseNotes } = require('./src/releaseNotes');
const { removeScannerResult } = require('./src/scannerResults');
const { autoSelectedCandidate, extractBoothEvidence, initialOrigin, searchBooth } = require('./src/boothOriginFinder');
const { createUpdatePromptOptions, shouldInstallNow } = require('./src/updatePrompt');
const { createShowcaseSnapshot, publishShowcaseSnapshot } = require('./src/showcaseSnapshot');

const store = new Store();
const monitor = new DownloadsMonitor(onFileDetected);

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('error', err => logger.warn('autoupdate-error', { message: err.message }));
autoUpdater.on('update-available', info => logger.info('autoupdate-available', { version: info.version }));
autoUpdater.on('update-downloaded', async info => {
  logger.info('autoupdate-downloaded', { version: info.version });
  if (updatePromptShown) return;
  updatePromptShown = true;

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.restore();
      mainWindow.focus();
    }
    const options = createUpdatePromptOptions(info.version);
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    if (shouldInstallNow(result)) {
      app.isQuitting = true;
      autoUpdater.quitAndInstall(false, true);
    } else {
      logger.info('autoupdate-deferred', { version: info.version });
    }
  } catch (err) {
    logger.warn('autoupdate-prompt-failed', { message: err.message });
  }
});

console.log('[main] starting, gotTheLock check...');
const gotTheLock = app.requestSingleInstanceLock();
console.log('[main] gotTheLock:', gotTheLock);

let mainWindow = null;
let modalWindow = null;
let tray = null;
let freeItemsTimer = null;
let freeItemsScanCancelled = false;
let updatePromptShown = false;
const pendingImportIntents = new Map();

// IPC is a privileged boundary. Accept messages only from our two known local
// renderer windows. Remote/auth windows never receive this bridge.
function ipcSenderRole(event) {
  const sender = event && event.sender;
  if (!sender || sender.isDestroyed() || !event.senderFrame || event.senderFrame !== sender.mainFrame) return null;
  let role = null;
  if (sender === (mainWindow && mainWindow.webContents)) role = 'main';
  if (sender === (modalWindow && modalWindow.webContents)) role = 'modal';
  if (!role) return null;
  const frameUrl = event.senderFrame && event.senderFrame.url;
  if (!frameUrl || !frameUrl.startsWith('file://')) return null;
  try {
    const localPath = fileURLToPath(frameUrl);
    const expected = role === 'modal' ? 'modal.html' : null;
    const basename = path.basename(path.resolve(localPath)).toLowerCase();
    if (expected && basename !== expected) return null;
    if (!expected && !['index.html', 'settings.html'].includes(basename)) return null;
    return role;
  } catch (_) { return null; }
}

const MODAL_IPC_CHANNELS = new Set([
  'get-assets', 'get-all-tags', 'pick-files', 'scrape-images', 'wait-for-file',
  'import-asset', 'update-asset', 'add-file-to-asset', 'open-import-modal', 'close-modal', 'refresh-library',
]);
function isTrustedIpcSender(event, channel) {
  const role = ipcSenderRole(event);
  if (!role) return false;
  if (role === 'modal') return MODAL_IPC_CHANNELS.has(channel);
  return true;
}

const _ipcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => _ipcHandle(channel, (event, ...args) => {
  if (!isTrustedIpcSender(event, channel)) throw new Error('Unauthorized IPC sender');
  return listener(event, ...args);
});
const _ipcOn = ipcMain.on.bind(ipcMain);
ipcMain.on = (channel, listener) => _ipcOn(channel, (event, ...args) => {
  if (!isTrustedIpcSender(event, channel)) return;
  return listener(event, ...args);
});

function allowExternalUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' && !u.username && !u.password && String(value).length <= 8192 && !/[\x00-\x1f\x7f]/.test(String(value));
  } catch (_) { return false; }
}

function allowBoothUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' && !u.username && !u.password &&
      (u.hostname === 'booth.pm' || u.hostname.endsWith('.booth.pm')) &&
      u.pathname.length < 512;
  } catch (_) { return false; }
}

function isAllowedLocalPage(value, allowedNames) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') return false;
    const localPath = path.resolve(fileURLToPath(parsed));
    const rendererRoot = path.resolve(__dirname, 'renderer');
    if (!localPath.toLowerCase().startsWith((rendererRoot + path.sep).toLowerCase())) return false;
    return allowedNames.includes(path.basename(localPath).toLowerCase());
  } catch (_) { return false; }
}

const ICON = path.join(__dirname, 'assets', 'icon.png');

// ── Malware scanning ──────────────────────────────────────────────────────────
const SCANNABLE_EXTS = new Set(['.unitypackage', '.zip', '.rar', '.7z']);
const activeMalwareScans = new Set();

// Fire-and-forget: scans a freshly imported (or manually re-requested) asset's
// files in the background and updates its meta.json + pushes UI events once
// the scan completes. `force` bypasses the auto-scan-on-import toggle for
// scans the user explicitly requested (e.g. via the right-click menu).
function runMalwareScanForAsset(assetId, { force = false, onDone = null } = {}) {
  if (!force && !store.get('malwareScanEnabled', true)) return 'disabled';
  if (!store.get('malwareScannerAvailable', false)) return 'not-available';
  if (activeMalwareScans.has(assetId)) return 'already-running';
  const scannerExe = store.get('malwareScannerPath', null);
  if (!scannerExe) return 'not-available';

  const rootFolder = store.get('rootFolder', '');
  let assetDir, metaPath, meta;
  try {
    assetDir = resolveExistingAssetDir(rootFolder, assetId);
    metaPath = path.join(assetDir, 'meta.json');
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (err) {
    logger.warn('malware-scan-setup-failed', { message: err.message });
    return 'error';
  }

  const files = (meta.files || []).filter(f => SCANNABLE_EXTS.has(path.extname(f).toLowerCase()));
  if (files.length === 0) return 'no-files';

  activeMalwareScans.add(assetId);
  const targets = files.map(f => ({ assetId, filePath: resolveAssetFile(rootFolder, assetId, f) }));

  const notifyProgress = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('malware-scan-progress', payload);
  };
  notifyProgress({ assetId, active: true, label: `Scanning ${meta.name || assetId}…` });

  scanTargets(targets, scannerExe, {
    onProgress: (msg) => {
      if (msg.type === 'progress') {
        notifyProgress({ assetId, active: true, label: `Scanning ${msg.file} (${msg.index}/${msg.total})…` });
      }
    },
  }).then(({ results }) => {
    const SEVERITY_ORDER = ['clean', 'low', 'medium', 'high', 'critical', 'error'];
    let worst = null;
    for (const r of results) {
      if (!worst || SEVERITY_ORDER.indexOf(r.severity) > SEVERITY_ORDER.indexOf(worst.severity)) worst = r;
    }
    const severity = worst ? worst.severity : 'clean';

    try {
      const current = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      current.scanStatus = severity;
      current.scanScore = worst ? worst.score : null;
      current.scanFindings = worst ? worst.findings : null;
      current.scanFile = worst ? worst.scannedFile : null;
      current.scanRecommendation = worst ? worst.recommendation : null;
      current.scanOutput = worst ? worst.raw : '';
      current.scannedAt = new Date().toISOString();
      current.scanAcknowledged = false;
      current.scanMarkedSafe = false; // a fresh scan result always supersedes a prior manual override
      writeJsonAtomic(metaPath, current);
      const { touchIndexEntry } = require('./src/assetManager');
      touchIndexEntry(store, assetId, current);
    } catch (err) {
      logger.warn('malware-scan-meta-write-failed', { message: err.message });
    }

    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('refresh-library', { assetId });
    if (['critical', 'high', 'medium'].includes(severity)) {
      notifyProgress({ assetId, active: false });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('malware-scan-flagged', {
          assetId, name: meta.name || assetId, severity,
          score: worst ? worst.score : null,
          findings: worst ? worst.findings : null,
          scannedFile: worst ? worst.scannedFile : null,
          recommendation: worst ? worst.recommendation : null,
          output: worst ? worst.raw : '',
        });
      }
    } else {
      notifyProgress({ assetId, active: false });
    }
  }).catch(err => {
    logger.warn('malware-scan-failed', { message: err.message });
    notifyProgress({ assetId, active: false });
  }).finally(() => {
    activeMalwareScans.delete(assetId);
    if (onDone) onDone();
  });
  return 'started';
}

// ── Manual "Scan All" queue ───────────────────────────────────────────────────
// Queues every scannable asset and runs them one at a time (not concurrently),
// yielding to any scan already in flight (import-triggered, right-click, or
// the idle backlog sweep) rather than racing it.
const manualScanQueue = [];
let manualScanQueueDraining = false;

function drainManualScanQueue() {
  if (manualScanQueueDraining) return;
  if (activeMalwareScans.size > 0) return;
  while (manualScanQueue.length > 0) {
    const nextId = manualScanQueue.shift();
    manualScanQueueDraining = true;
    const status = runMalwareScanForAsset(nextId, {
      force: true,
      onDone: () => { manualScanQueueDraining = false; drainManualScanQueue(); },
    });
    if (status === 'started') return; // resumes via onDone once this scan finishes
    manualScanQueueDraining = false; // synchronous no-op (no files, already running, etc.) — try the next one
  }
}

function queueAssetsForManualScan(assetIds) {
  for (const id of assetIds) if (!manualScanQueue.includes(id)) manualScanQueue.push(id);
  drainManualScanQueue();
}

// ── Idle backlog scan ─────────────────────────────────────────────────────────
// Sweeps the existing library for assets that have never been scanned and
// checks them one at a time, only while the system has been idle for a while,
// so it never competes with whatever the user is actively doing.
const BACKLOG_IDLE_SECONDS = 180; // "a few minutes"
const BACKLOG_CHECK_INTERVAL_MS = 30_000;
let backlogScanTimer = null;

function findNextBacklogAsset() {
  const { getAssets } = require('./src/assetManager');
  const assets = getAssets(store)
    .filter(a => !a.scannedAt && (a.files || []).some(f => SCANNABLE_EXTS.has(path.extname(f).toLowerCase())))
    .sort((a, b) => new Date(a.importedAt) - new Date(b.importedAt));
  return assets.length ? assets[0].id : null;
}

function maybeRunBacklogScan() {
  if (!store.get('malwareBacklogScanEnabled', true)) return;
  if (!store.get('malwareScannerAvailable', false)) return;
  if (activeMalwareScans.size > 0) return;
  if (powerMonitor.getSystemIdleTime() < BACKLOG_IDLE_SECONDS) return;

  let assetId;
  try { assetId = findNextBacklogAsset(); } catch (err) { logger.warn('malware-backlog-scan-lookup-failed', { message: err.message }); return; }
  if (assetId) runMalwareScanForAsset(assetId, { force: true });
}

function startBacklogScanTimer() {
  if (backlogScanTimer) return;
  backlogScanTimer = setInterval(maybeRunBacklogScan, BACKLOG_CHECK_INTERVAL_MS);
}

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
    const duplicate = [this.active, ...this.queue].find(item => item && item.dlUrl === job.dlUrl);
    if (duplicate) return duplicate.id;

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
      if (this.active.assetId) {
        const { discardIncompleteDownload } = require('./src/assetManager');
        if (discardIncompleteDownload({ assetId: this.active.assetId, store }) && mainWindow) {
          mainWindow.webContents.send('refresh-library', {});
        }
      }
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
    console.log('[queue] running job:', JSON.stringify({ dlUrl, fileName, itemId, originUrl, freeItemPending: item.freeItemPending }, null, 2));

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
    const { createAssetShell, finalizeAssetDownload, findExistingBoothAsset } = require('./src/assetManager');

    let assetName = fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    let tags = [];
    let selectedImageUrl = null;
    let isAdult = false;

    if (originUrl) {
      try {
        const scraped = await scrapePageMeta(originUrl);
        if (scraped.name)   assetName        = scraped.name;
        if (scraped.tags?.length)  tags        = scraped.tags;
        if (scraped.images?.length) selectedImageUrl = scraped.images[0].url;
        isAdult = !!scraped.isAdult;
      } catch (err) {
        console.warn('[queue] scrape failed:', err.message);
      }
    }

    if (item.cancelled) return;

    const existingAsset = findExistingBoothAsset({ originUrl, itemId, store });
    const shell = existingAsset
      ? { assetId: existingAsset.id, meta: existingAsset, isExisting: true }
      : await createAssetShell({ originUrl, assetName, selectedImageUrl, tags, isAdult, store });
    item.assetId = shell.assetId;
    if (!shell.isExisting && mainWindow) mainWindow.webContents.send('refresh-library', { assetId: shell.assetId });

    if (item.cancelled) {
      // Clean up shell if cancelled before download
      const { deleteAsset } = require('./src/assetManager');
      if (!shell.isExisting) deleteAsset({ assetId: shell.assetId, store });
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
    runMalwareScanForAsset(shell.assetId);

    // If this came from the free items scraper, mark it as pending review
    if (item.freeItemPending) {
      const rootFolder = store.get('rootFolder', '');
      let assetDir;
      try { assetDir = resolveExistingAssetDir(rootFolder, shell.assetId); } catch { assetDir = null; }
      const metaPath = assetDir ? path.join(assetDir, 'meta.json') : null;
      if (metaPath && fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        meta.freeItemPending = true;
        writeJsonAtomic(metaPath, meta);
      }
      const freeEntry = {
        assetId: shell.assetId,
        name: shell.meta.name,
        thumbnailPath: shell.meta.thumbnail
          ? (assetDir ? resolveAssetFile(rootFolder, shell.assetId, shell.meta.thumbnail) : null)
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
  try {
    const intent = parseImportIntent(url);
    pendingImportIntents.set(intent.filename.toLowerCase(), { ...intent, expiresAt: Date.now() + 10 * 60 * 1000 });
    return;
  } catch (_) { /* Try a download protocol next. */ }
  try {
    const parsed = parseDownloadProtocol(url);
    if (parsed.scheme === 'vroid.closet' || parsed.scheme === 'booth-library-manager') {
      handleBoothDownloadUrl(url);
    }
  } catch (err) {
    console.warn('[URL scheme] rejected:', err.message);
  }
}

function handleBoothDownloadUrl(url, freeItemPending = false) {
  console.log('[booth-download] raw url:', url);
  try {
    const parsed = parseDownloadProtocol(url);
    if (!['vroid.closet', 'booth-library-manager'].includes(parsed.scheme)) throw new Error('Unsupported download scheme');
    const originUrl = parsed.itemId ? `https://booth.pm/en/items/${parsed.itemId}` : '';
    const job = {
      dlUrl: parsed.dlurl,
      fileName: parsed.filename,
      itemId: parsed.itemId,
      originUrl,
      freeItemPending,
    };
    const queueId = downloadQueue.add(job);
    console.log(`[booth-download] queued #${queueId}`);
  } catch (err) {
    console.warn('[booth-download] rejected:', err.message);
  }
}

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    // On Windows the URL is passed as the last command-line argument
    const url = argv.find(arg => /^(booth-library-manager|bunslm|rslimman|vroid\.closet):\/\//i.test(arg));
    if (url) handleUrl(url);

    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    const configuredRoot = store.get('rootFolder', '');
    if (configuredRoot && fs.existsSync(configuredRoot)) {
      try {
        const { cleanupIncompleteDownloads } = require('./src/assetManager');
        const removed = cleanupIncompleteDownloads(store);
        if (removed > 0) console.log(`[startup] removed ${removed} incomplete download shell(s)`);
      } catch (err) { console.warn('[startup] incomplete download cleanup failed:', err.message); }
      try { cleanupStaging(configuredRoot); } catch (err) { console.warn('[startup] staging cleanup failed:', err.message); }
    }
    createTray();
    createMainWindow();

    // Handle URL if app was cold-launched via a scheme (Windows passes it in argv)
    const url = process.argv.find(arg => /^(booth-library-manager|bunslm|rslimman|vroid\.closet):\/\//i.test(arg));
    if (url) handleUrl(url);

    // Start monitor if it was enabled on last run
    if (store.get('monitorEnabled', false)) {
      monitor.start(store.get('downloadsFolder', app.getPath('downloads')));
    }

    // Schedule free items auto-scan if interval is set
    scheduleFreeItemsInterval();

    if (app.isPackaged) {
      autoUpdater.checkForUpdates().catch(err => {
        logger.warn('autoupdate-check-failed', { message: err.message });
      });
    }

    ensureScannerUpdated(store).catch(err => {
      logger.warn('malware-scanner-startup-failed', { message: err.message });
    });
    startBacklogScanTimer();
  });

  app.on('before-quit', () => { app.isQuitting = true; });
  app.on('quit', () => { monitor.stop(); if (backlogScanTimer) clearInterval(backlogScanTimer); });
}

function downloadWithProgress(url, destPath, itemId, redirectCount = 0, onProgress = null) {
  const https = require('https');

  if (redirectCount > 5) return Promise.reject(new Error('Too many redirects'));
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Only authenticated HTTPS downloads are allowed');
  } catch (err) {
    return Promise.reject(new Error(`Invalid download URL: ${err.message}`));
  }

  return new Promise((resolve, reject) => {
    const proto = https;
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
        const redirectUrl = new URL(location, url).href;
        try {
          const parsedRedirect = new URL(redirectUrl);
          if (parsedRedirect.protocol !== 'https:' || parsedRedirect.username || parsedRedirect.password) throw new Error('Redirect is not HTTPS');
        } catch (err) {
          return reject(new Error(`Unsafe download redirect: ${err.message}`));
        }
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
      file.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
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
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
    title: "BB's LibMan",
    show: false,
  });

  mainWindow.loadFile('renderer/index.html');
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedLocalPage(url, ['index.html', 'settings.html'])) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Background health check: reconcile the asset index against the real
  // folders once per session, after the initial (index-served) library load.
  mainWindow.webContents.once('did-finish-load', () => {
    setImmediate(() => {
      const { reconcileIndex } = require('./src/assetManager');
      let result;
      try { result = reconcileIndex(store); } catch (e) { console.error('[assetIndex] reconcile failed:', e.message); return; }
      if (!result) return;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('refresh-library', {});
      if (store.get('libraryHealthNotify', false)) {
        const notif = new Notification({
          title: "BB's LibMan — Library re-synced",
          body: `${result.added} added, ${result.removed} missing/corrupt, ${result.changed} changed.`,
          icon: ICON,
        });
        notif.show();
      }
    });
  });

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
  if (modalWindow && !modalWindow.isDestroyed()) {
    modalWindow.focus();
    return;
  }
  modalWindow = null;

  modalWindow = new BrowserWindow({
    width: 720,
    height: 640,
    resizable: false,
    modal: false,
    parent: mainWindow || undefined,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload-modal.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
    title: 'Import Asset',
    show: false,
  });

  modalWindow.loadFile('renderer/modal.html').catch(() => {
    if (modalWindow && !modalWindow.isDestroyed()) modalWindow.destroy();
    modalWindow = null;
  });
  modalWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  modalWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedLocalPage(url, ['modal.html'])) event.preventDefault();
  });
  modalWindow.once('ready-to-show', () => {
    modalWindow.show();
    modalWindow.webContents.send('import-data', importData);
  });
  modalWindow.on('closed', () => { modalWindow = null; });
  modalWindow.webContents.on('render-process-gone', () => { modalWindow = null; });
}

// ── Downloads monitor callback ────────────────────────────────────────────────

function onFileDetected(filePath) {
  const fileName = path.basename(filePath);
  const key = fileName.toLowerCase();
  const intent = pendingImportIntents.get(key);
  if (intent && intent.expiresAt > Date.now()) pendingImportIntents.delete(key);
  else if (intent) pendingImportIntents.delete(key);
  const importData = intent && intent.expiresAt > Date.now()
    ? { originUrl: intent.originUrl, fileName, filePath }
    : { originUrl: '', fileName, filePath };

  if (modalWindow && !modalWindow.isDestroyed()) {
    // Modal already open — push the new file into it
    modalWindow.webContents.send('modal-file-detected', importData);
    modalWindow.restore();
    modalWindow.focus();
  } else {
    createModalWindow(importData);
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
  appVersion: app.getVersion(),
  rootFolder: store.get('rootFolder', ''),
  watchedDomains: store.get('watchedDomains', []),
  downloadsFolder: store.get('downloadsFolder', app.getPath('downloads')),
  monitorEnabled: store.get('monitorEnabled', false),
  notificationsEnabled: store.get('notificationsEnabled', true),
  libraryHealthNotify: store.get('libraryHealthNotify', false),
  boothEnabled: store.get('boothEnabled', false),
  boothDownloadsFolder: store.get('boothDownloadsFolder', ''),
  malwareScanEnabled: store.get('malwareScanEnabled', true),
  malwareBacklogScanEnabled: store.get('malwareBacklogScanEnabled', true),
  malwareScannerPath: store.get('malwareScannerPath', null),
  malwareScannerVersion: store.get('malwareScannerVersion', null),
  malwareScannerAvailable: store.get('malwareScannerAvailable', false),
  showcasePublishUrl: store.get('showcasePublishUrl', ''),
  showcaseTokenConfigured: Boolean(store.get('showcasePublishToken', '')),
  showcaseLastPublishedAt: store.get('showcaseLastPublishedAt', ''),
}));

ipcMain.handle('get-release-notes', () => {
  const version = app.getVersion();
  let markdown = '';
  try {
    markdown = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8');
  } catch (err) {
    logger.warn('release-notes-read-failed', { message: err.message });
  }
  return {
    ...parseReleaseNotes(markdown, version),
    isNew: store.get('releaseNotesVersion', null) !== version,
  };
});

ipcMain.handle('acknowledge-release-notes', () => {
  store.set('releaseNotesVersion', app.getVersion());
  return true;
});

ipcMain.handle('get-booth-items', () => {
  const enabled = store.get('boothEnabled', false);
  if (!enabled) return [];

  // Resolve path: %AppData%/Roaming/pm.booth.library-manager/data.db
  const roamingDir = path.dirname(app.getPath('userData')); // …/Roaming
  const boothDb = path.join(roamingDir, 'pm.booth.library-manager', 'data.db');

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
  if (config.libraryHealthNotify !== undefined) store.set('libraryHealthNotify', config.libraryHealthNotify);
  if (config.boothEnabled !== undefined) store.set('boothEnabled', config.boothEnabled);
  if (config.boothDownloadsFolder !== undefined) store.set('boothDownloadsFolder', config.boothDownloadsFolder);
  if (config.malwareScanEnabled !== undefined) store.set('malwareScanEnabled', config.malwareScanEnabled);
  if (config.malwareBacklogScanEnabled !== undefined) store.set('malwareBacklogScanEnabled', config.malwareBacklogScanEnabled);
  if (typeof config.showcasePublishUrl === 'string') store.set('showcasePublishUrl', config.showcasePublishUrl.trim().slice(0, 2048));
  if (typeof config.showcasePublishToken === 'string' && config.showcasePublishToken.trim()) store.set('showcasePublishToken', config.showcasePublishToken.trim());
  return true;
});

ipcMain.handle('create-showcase-snapshot', async () => {
  const outputPath = path.join(app.getPath('documents'), 'BBLM Showcase', 'bblm-showcase.json');
  return createShowcaseSnapshot({ store, outputPath });
});

ipcMain.handle('publish-showcase', async () => {
  const publishUrl = store.get('showcasePublishUrl', '');
  const token = store.get('showcasePublishToken', '');
  if (!publishUrl) throw new Error('Set the showcase site URL first.');
  if (!token) throw new Error('Set the showcase publishing token first.');
  const outputPath = path.join(app.getPath('documents'), 'BBLM Showcase', 'bblm-showcase.json');
  const snapshot = await createShowcaseSnapshot({ store, outputPath });
  const result = await publishShowcaseSnapshot({ publishUrl, token, snapshotPath: outputPath });
  store.set('showcaseLastPublishedAt', result.generatedAt || snapshot.generatedAt);
  return { ...result, outputPath };
});

ipcMain.handle('copy-to-clipboard', (event, text) => {
  clipboard.writeText(typeof text === 'string' ? text.slice(0, 200 * 1024) : '');
  return true;
});

ipcMain.handle('malware-scan-now', (event, assetIds) => {
  const ids = Array.isArray(assetIds) ? assetIds : [assetIds];
  const results = {};
  for (const id of ids) results[id] = runMalwareScanForAsset(id, { force: true });
  return results;
});

ipcMain.handle('malware-scan-all', () => {
  if (!store.get('malwareScannerAvailable', false)) return { ok: false, error: 'not-available' };
  const { getAssets } = require('./src/assetManager');
  const ids = getAssets(store)
    .filter(a => (a.files || []).some(f => SCANNABLE_EXTS.has(path.extname(f).toLowerCase())))
    .map(a => a.id);
  if (ids.length === 0) return { ok: false, error: 'no-files' };
  queueAssetsForManualScan(ids);
  return { ok: true, queued: ids.length };
});

// User override for Medium/Low findings the scanner flagged but the user has
// reviewed and judged to be a false positive. Cleared automatically the next
// time this asset is scanned (see runMalwareScanForAsset) so a stale override
// never masks a genuinely new finding.
ipcMain.handle('malware-mark-safe', (event, assetId) => {
  const rootFolder = store.get('rootFolder', '');
  const assetDir = resolveExistingAssetDir(rootFolder, assetId);
  const metaPath = path.join(assetDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return false;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.scanStatus === 'critical') return false; // Critical can never be waved off as safe
  meta.scanMarkedSafe = true;
  meta.scanAcknowledged = true;
  writeJsonAtomic(metaPath, meta);
  const { touchIndexEntry } = require('./src/assetManager');
  touchIndexEntry(store, assetId, meta);
  return true;
});

// Explicit opposite of malware-mark-safe: clears any prior safe override so
// the card's flagged highlight comes back (e.g. the user marked it safe
// earlier, then changed their mind), and acknowledges so it doesn't also
// re-queue an automatic popup.
ipcMain.handle('malware-mark-unsafe', (event, assetId) => {
  const rootFolder = store.get('rootFolder', '');
  const assetDir = resolveExistingAssetDir(rootFolder, assetId);
  const metaPath = path.join(assetDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return false;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.scanMarkedSafe = false;
  meta.scanAcknowledged = true;
  writeJsonAtomic(metaPath, meta);
  const { touchIndexEntry } = require('./src/assetManager');
  touchIndexEntry(store, assetId, meta);
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
  const assetDir = resolveExistingAssetDir(rootFolder, assetId);
  const metaPath   = path.join(assetDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return { error: 'Asset not found' };

  const fileName = sanitizeExternalFilename(path.basename(filePath));
  const destFile = resolveAssetFile(rootFolder, assetId, fileName);
  try {
    fs.renameSync(filePath, destFile);
  } catch (err) {
    if (err.code === 'EXDEV') { fs.copyFileSync(filePath, destFile); fs.unlinkSync(filePath); }
    else return { error: err.message };
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (!meta.files) meta.files = [];
  if (!meta.files.includes(fileName)) meta.files.push(fileName);
  writeJsonAtomic(metaPath, meta);
  require('./src/assetManager').touchIndexEntry(store, assetId, meta);
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

ipcMain.handle('import-asset', async (event, { originUrl, filePath, selectedImageUrl, assetName, tags, isAdult }) => {
  const { importAsset } = require('./src/assetManager');
  const result = await importAsset({ originUrl, filePath, selectedImageUrl, assetName, tags, isAdult, store });
  runMalwareScanForAsset(result.assetId);
  return result;
});

ipcMain.handle('open-booth-folder', (event, localFolder) => {
  if (localFolder && fs.existsSync(localFolder)) {
    shell.openPath(localFolder);
  }
});

ipcMain.handle('open-asset-folder', (event, assetId) => {
  const rootFolder = store.get('rootFolder', '');
  try { shell.openPath(resolveExistingAssetDir(rootFolder, assetId)); } catch (_) { return false; }
  return true;
});

// ── Unity companion: project discovery via shared heartbeat registry ──────────
// Any open Unity project with BBLM_Importer.cs installed writes a heartbeat
// file here every few seconds. We treat entries seen recently as "currently
// open" — this is how BBLM finds a target project without the user having to
// point it at one manually every time they switch projects.
const UNITY_REGISTRY_DIR = path.join(app.getPath('appData'), 'BBLM', 'unity-projects');
const UNITY_HEARTBEAT_STALE_MS = 30000;

function getOpenUnityProjects() {
  let entries;
  try { entries = fs.readdirSync(UNITY_REGISTRY_DIR); } catch { return []; }

  const now = Date.now();
  const projects = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = fs.readFileSync(path.join(UNITY_REGISTRY_DIR, entry), 'utf8').replace(/^﻿/, '');
      const data = JSON.parse(raw);
      const lastSeen = Date.parse(data.lastSeen);
      if (!data.projectPath || !Number.isFinite(lastSeen)) continue;
      if (now - lastSeen > UNITY_HEARTBEAT_STALE_MS) continue;
      projects.push({ projectPath: data.projectPath, projectName: data.projectName || path.basename(data.projectPath), pid: Number.isInteger(data.pid) ? data.pid : null });
    } catch { /* skip malformed/partially-written heartbeat files */ }
  }
  return projects.sort((a, b) => a.projectName.localeCompare(b.projectName));
}

ipcMain.handle('get-unity-projects', () => getOpenUnityProjects());

ipcMain.handle('focus-unity-project', (event, projectPath) => {
  const project = getOpenUnityProjects().find(item => item.projectPath === projectPath && Number.isInteger(item.pid));
  if (!project) return { ok: false };
  const { spawn } = require('child_process');
  const pid = String(project.pid);
  const script = [
    "$signature = @'",
    'using System; using System.Runtime.InteropServices; public static class BBLMFocus {',
    '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); }',
    "'@",
    'Add-Type -TypeDefinition $signature',
    `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){ $shell=New-Object -ComObject WScript.Shell; for($i=0;$i -lt 10;$i++){ $shell.AppActivate($p.Id) | Out-Null; [BBLMFocus]::ShowWindowAsync($p.MainWindowHandle,9); [BBLMFocus]::SetForegroundWindow($p.MainWindowHandle); Start-Sleep -Milliseconds 100 } }`,
  ].join('\n');
  try { spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, stdio: 'ignore' }); } catch (_) { return { ok: false }; }
  return { ok: true };
});

ipcMain.handle('get-unity-import-entries', async (event, assetId) => {
  const rootFolder = store.get('rootFolder', '');
  let assetDir;
  try { assetDir = resolveExistingAssetDir(rootFolder, assetId); } catch (_) { return { ok: false, error: 'asset-not-found' }; }
  const metaPath = path.join(assetDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return { ok: false, error: 'asset-not-found' };
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const archives = (meta.files || [])
      .filter(file => ['.zip', '.rar', '.7z', '.unitypackage'].includes(path.extname(file).toLowerCase()))
      .map(file => resolveAssetFile(rootFolder, assetId, file));
    if (!archives.length) return { ok: false, error: 'no-package' };
    const { listUnityImportEntries } = require('./src/unityImport');
    return { ok: true, entries: await listUnityImportEntries(archives) };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('import-to-unity', async (event, { assetId, projectPath, selections }) => {
  const rootFolder = store.get('rootFolder', '');
  if (!projectPath) return { ok: false, error: 'no-project' };
  if (!fs.existsSync(path.join(projectPath, 'Assets')) ||
      !fs.existsSync(path.join(projectPath, 'ProjectSettings'))) {
    return { ok: false, error: 'invalid-project' };
  }

  let assetDir;
  try { assetDir = resolveExistingAssetDir(rootFolder, assetId); } catch (_) { return { ok: false, error: 'asset-not-found' }; }
  const metaPath = path.join(assetDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return { ok: false, error: 'asset-not-found' };

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const archives = (meta.files || [])
    .filter(file => ['.zip', '.rar', '.7z', '.unitypackage'].includes(path.extname(file).toLowerCase()))
    .map(file => resolveAssetFile(rootFolder, assetId, file));
  if (!archives.length) return { ok: false, error: 'no-package' };

  try {
    const { listUnityImportEntries, extractSelectedUnityFiles } = require('./src/unityImport');
    const available = await listUnityImportEntries(archives);
    const requested = Array.isArray(selections) ? selections : available;
    const allowed = new Map(available.map(entry => [entry.key, entry]));
    const selected = requested.map(item => allowed.get(item.key)).filter(Boolean);
    if (!selected.length) return { ok: false, error: 'no-files-selected' };
    await extractSelectedUnityFiles(archives, selected, path.join(projectPath, 'Assets'), {
      unityPackageDestination: path.join(projectPath, 'BBLM_Import'),
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return { ok: true };
});

ipcMain.handle('reveal-unity-companion', () => {
  // Copy out of app.asar (not a real path on disk once packaged) to a writable folder, then reveal it.
  const src = path.join(__dirname, 'companion', 'unity', 'BBLM_Importer.unitypackage');
  const destDir = path.join(app.getPath('userData'), 'companion');
  const dest = path.join(destDir, 'BBLM_Importer.unitypackage');
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  shell.showItemInFolder(dest);
});

ipcMain.handle('open-external', (event, url) => {
  if (!allowExternalUrl(url)) throw new Error('External URL is not allowed');
  return shell.openExternal(url);
});

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
  console.log('[free-item-download] deeplink:', deeplinkUrl);
  return new Promise((resolve, reject) => {
    if (!allowBoothUrl(deeplinkUrl)) return reject(new Error('Invalid Booth URL'));
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
        sandbox: true,
        webSecurity: true,
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
      if (!win.isDestroyed() && allowBoothUrl(deeplinkUrl)) win.loadURL(deeplinkUrl);
    };

    win.webContents.setWindowOpenHandler(({ url }) => {
      console.log('[free-item-download] window-open:', url);
      if (url.startsWith('booth-library-manager://') || url.startsWith('vroid.closet://')) {
        handleBoothDownloadUrl(url, false);
        finish(null);
      }
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      console.log('[free-item-download] will-navigate:', url);
      if (url.startsWith('booth-library-manager://') || url.startsWith('vroid.closet://')) {
        event.preventDefault();
        handleBoothDownloadUrl(url, false);
        finish(null);
        return;
      }
      if (!allowBoothUrl(url)) event.preventDefault();
    });

    // Intercept the scheme redirect before the OS handles it
    win.webContents.on('will-redirect', (event, url) => {
      console.log('[free-item-download] will-redirect:', url);
      if (url.startsWith('booth-library-manager://') || url.startsWith('vroid.closet://')) {
        event.preventDefault();
        handleBoothDownloadUrl(url, false);
        finish(null);
      }
    });

    win.webContents.on('did-navigate', (event, url) => {
      console.log('[free-item-download] did-navigate:', url);
      if (done) return;
      const isSignIn = /\/users\/sign_in|\/login/i.test(url);
      if (isSignIn) {
        // Need credentials — show the window
        if (!win.isVisible()) win.show();
      } else if (win.isVisible() && allowBoothUrl(url)) {
        // User just logged in; retry the deeplink
        setTimeout(loadDeeplink, 400);
      }
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.log('[free-item-download] did-fail-load:', errorCode, errorDescription, validatedURL);
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
  let assetDir;
  try { assetDir = resolveExistingAssetDir(rootFolder, assetId); } catch { return false; }
  const metaPath = path.join(assetDir, 'meta.json');
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    delete meta.freeItemPending;
    writeJsonAtomic(metaPath, meta);
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
let scannerWorker = null;
const ORIGIN_REQUEST_DELAY_MS = 8000;
const ORIGIN_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
let originFinderTimer = null;
let originFinderInFlight = false;
let originFinderQueue = [];
let originFinderState = { running: false, paused: false, processed: 0, total: 0, nextRequestAt: 0, message: 'Ready' };

function sendOriginFinder(type, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('origin-finder-update', { type, ...data });
}

function setScannerOrigin(archive, origin) {
  const stampedOrigin = { ...origin, updatedAt: Date.now() };
  const results = store.get('scannerResults', []);
  let selectedOriginUrl = '';
  const updated = results.map(result => {
    if (result.archive !== archive) return result;
    selectedOriginUrl = result.selectedOriginUrl || autoSelectedCandidate(stampedOrigin)?.url || '';
    return { ...result, origin: stampedOrigin, selectedOriginUrl };
  });
  store.set('scannerResults', updated);
  sendOriginFinder('result', { archive, origin: stampedOrigin, selectedOriginUrl, state: originFinderState });
}

function saveOriginCache(query, candidates) {
  const cache = store.get('boothOriginCache', {});
  cache[query.toLowerCase()] = { savedAt: Date.now(), candidates };
  const keys = Object.keys(cache).sort((a, b) => Number(cache[b]?.savedAt || 0) - Number(cache[a]?.savedAt || 0));
  for (const key of keys.slice(1000)) delete cache[key];
  store.set('boothOriginCache', cache);
}

function cachedOriginCandidates(query) {
  const entry = store.get('boothOriginCache', {})[query.toLowerCase()];
  if (!entry || Date.now() - Number(entry.savedAt || 0) > ORIGIN_CACHE_MAX_AGE_MS) return null;
  return Array.isArray(entry.candidates) ? entry.candidates : [];
}

function prepareOriginResult(result) {
  if (result.origin?.queryVersion === 3) return result;
  const previousAutomaticUrl = result.origin?.status === 'exact' ? result.origin?.candidates?.[0]?.url : '';
  const refreshed = extractBoothEvidence({ archivePath: result.archive, pathnames: result.pathnames || [result.content] });
  const storedEvidence = result.originEvidence || {};
  const originEvidence = {
    ...storedEvidence,
    query: refreshed.query,
    terms: refreshed.terms,
    itemIds: [...new Set([...(storedEvidence.itemIds || []), ...refreshed.itemIds])],
    filenameItemIds: [...new Set([...(storedEvidence.filenameItemIds || []), ...refreshed.filenameItemIds])],
  };
  const prepared = { ...result, originEvidence };
  return {
    ...prepared,
    origin: initialOrigin(prepared),
    selectedOriginUrl: result.selectedOriginUrl === previousAutomaticUrl ? '' : result.selectedOriginUrl,
  };
}

function scheduleNextOrigin(delay) {
  if (!originFinderState.running) return;
  originFinderState.nextRequestAt = Date.now() + delay;
  sendOriginFinder('state', { state: originFinderState });
  originFinderTimer = setTimeout(runNextOrigin, delay);
}

function runNextOrigin() {
  if (originFinderInFlight) return;
  originFinderInFlight = true;
  processNextOrigin()
    .catch(error => {
      originFinderState = { ...originFinderState, running: false, nextRequestAt: 0, message: `Origin Finder stopped: ${error.message}` };
      sendOriginFinder('state', { state: originFinderState });
    })
    .finally(() => { originFinderInFlight = false; });
}

async function processNextOrigin() {
  originFinderTimer = null;
  if (!originFinderState.running || originFinderState.paused) return;
  const archive = originFinderQueue.shift();
  if (!archive) {
    originFinderState = { ...originFinderState, running: false, paused: false, nextRequestAt: 0, message: 'Origin search complete' };
    sendOriginFinder('state', { state: originFinderState });
    return;
  }

  const result = store.get('scannerResults', []).find(item => item.archive === archive);
  if (!result) {
    originFinderState.processed++;
    scheduleNextOrigin(0);
    return;
  }
  const prepared = result.origin || initialOrigin(result);
  if (prepared.status === 'exact') {
    setScannerOrigin(archive, prepared);
    originFinderState.processed++;
    scheduleNextOrigin(0);
    return;
  }
  if (!prepared.query) {
    setScannerOrigin(archive, { ...prepared, status: 'not-found', candidates: [], message: 'Not enough local metadata to search' });
    originFinderState.processed++;
    scheduleNextOrigin(0);
    return;
  }

  setScannerOrigin(archive, { ...prepared, status: 'searching', message: `Searching BOOTH for “${prepared.query}”` });
  const cached = cachedOriginCandidates(prepared.query);
  try {
    const searchedCandidates = cached === null ? await searchBooth(prepared.query) : cached;
    if (cached === null) saveOriginCache(prepared.query, searchedCandidates);
    const candidates = [...(prepared.candidates || []), ...searchedCandidates]
      .filter((candidate, index, list) => list.findIndex(item => item.itemId === candidate.itemId) === index)
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 5);
    setScannerOrigin(archive, {
      ...prepared,
      status: candidates.length ? 'found' : 'not-found',
      candidates,
      message: candidates.length ? `${candidates.length} BOOTH candidate${candidates.length === 1 ? '' : 's'}` : 'No BOOTH candidates found',
      searchedAt: new Date().toISOString(),
    });
    originFinderState.processed++;
    originFinderState.message = `Checked ${originFinderState.processed} of ${originFinderState.total}`;
    scheduleNextOrigin(cached === null ? ORIGIN_REQUEST_DELAY_MS + Math.floor(Math.random() * 4000) : 25);
  } catch (error) {
    if (/HTTP 429/.test(error.message)) {
      originFinderQueue.unshift(archive);
      originFinderState.message = 'BOOTH asked BBLM to slow down. Waiting 5 minutes.';
      setScannerOrigin(archive, { ...prepared, status: 'waiting', message: originFinderState.message });
      scheduleNextOrigin(5 * 60 * 1000);
      return;
    }
    setScannerOrigin(archive, { ...prepared, status: 'error', message: error.message });
    originFinderState.processed++;
    originFinderState.message = `Could not check ${path.basename(archive)}`;
    scheduleNextOrigin(ORIGIN_REQUEST_DELAY_MS + Math.floor(Math.random() * 4000));
  }
}

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

ipcMain.handle('scanner-get-results', () => {
  const results = store.get('scannerResults', []).map(prepareOriginResult);
  store.set('scannerResults', results);
  return results;
});
ipcMain.handle('scanner-save-results',  (event, results) => {
  const previous = new Map(store.get('scannerResults', []).map(result => [result.archive, result]));
  const merged = (Array.isArray(results) ? results : []).map(result => {
    const old = previous.get(result.archive);
    const oldStamp = Number(old?.origin?.updatedAt || 0);
    const newStamp = Number(result?.origin?.updatedAt || 0);
    return oldStamp > newStamp ? { ...result, origin: old.origin } : result;
  });
  store.set('scannerResults', merged);
  return true;
});
ipcMain.handle('scanner-clear-results', () => {
  if (originFinderTimer) clearTimeout(originFinderTimer);
  originFinderTimer = null;
  originFinderQueue = [];
  originFinderState = { running: false, paused: false, processed: 0, total: 0, nextRequestAt: 0, message: 'Ready' };
  store.set('scannerResults', []);
  return true;
});
ipcMain.handle('scanner-get-folder', () => {
  const folderPath = store.get('scannerFolder', '');
  try {
    return typeof folderPath === 'string' && fs.statSync(folderPath).isDirectory() ? folderPath : '';
  } catch {
    return '';
  }
});

ipcMain.handle('origin-finder-state', () => originFinderState);

ipcMain.handle('origin-finder-search-one', (event, archive) => {
  const results = store.get('scannerResults', []);
  const index = results.findIndex(result => result.archive === archive);
  if (index < 0) return { ...originFinderState, error: 'Scanner result not found' };
  results[index] = prepareOriginResult(results[index]);
  store.set('scannerResults', results);
  if (['searching', 'waiting'].includes(results[index].origin?.status) || originFinderQueue.includes(archive)) return originFinderState;

  originFinderQueue.unshift(archive);
  if (originFinderState.running) {
    originFinderState.total++;
    originFinderState.message = `Queued ${path.basename(archive)}`;
    sendOriginFinder('state', { state: originFinderState });
    return originFinderState;
  }

  originFinderState = { running: true, paused: false, processed: 0, total: 1, nextRequestAt: 0, message: `Searching ${path.basename(archive)}` };
  sendOriginFinder('state', { state: originFinderState });
  runNextOrigin();
  return originFinderState;
});

ipcMain.handle('origin-finder-start', () => {
  if (originFinderState.running || originFinderInFlight) return originFinderState;
  if (originFinderTimer) clearTimeout(originFinderTimer);
  originFinderTimer = null;
  const results = store.get('scannerResults', []).map(prepareOriginResult);
  store.set('scannerResults', results);
  originFinderQueue = results
    .filter(result => !['exact', 'found'].includes(result.origin.status))
    .map(result => result.archive);
  originFinderState = {
    running: originFinderQueue.length > 0,
    paused: false,
    processed: 0,
    total: originFinderQueue.length,
    nextRequestAt: 0,
    message: originFinderQueue.length ? 'Starting BOOTH origin search' : 'No items need a BOOTH search',
  };
  for (const result of results) sendOriginFinder('result', { archive: result.archive, origin: result.origin, state: originFinderState });
  sendOriginFinder('state', { state: originFinderState });
  if (originFinderState.running) runNextOrigin();
  return originFinderState;
});

ipcMain.handle('origin-finder-pause', () => {
  if (originFinderTimer) clearTimeout(originFinderTimer);
  originFinderTimer = null;
  originFinderState = { ...originFinderState, running: false, paused: true, nextRequestAt: 0, message: 'Origin search paused' };
  sendOriginFinder('state', { state: originFinderState });
  return originFinderState;
});

ipcMain.handle('scanner-import-asset', async (event, { archivePath, originUrl }) => {
  const { scrapePageMeta } = require('./src/scraper');
  const { importAsset, appendToExistingBoothAsset } = require('./src/assetManager');

  try {
    const appended = appendToExistingBoothAsset({ originUrl, filePath: archivePath, store });
    if (appended) {
      const scannerResults = store.get('scannerResults', []);
      store.set('scannerResults', removeScannerResult(scannerResults, archivePath));
      if (mainWindow) mainWindow.webContents.send('refresh-library', { assetId: appended.assetId });
      runMalwareScanForAsset(appended.assetId);
      return { ok: true, assetId: appended.assetId, assetName: appended.meta.name };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }

  let assetName = path.basename(archivePath, path.extname(archivePath)).replace(/[-_]+/g, ' ').trim();
  let tags = [];
  let selectedImageUrl = null;
  let isAdult = false;

  if (originUrl) {
    try {
      const scraped = await scrapePageMeta(originUrl);
      if (scraped.name)           assetName        = scraped.name;
      if (scraped.tags?.length)   tags             = scraped.tags;
      if (scraped.images?.length) selectedImageUrl = scraped.images[0].url;
      isAdult = !!scraped.isAdult;
    } catch (err) {
      console.warn('[scanner-import] scrape failed:', err.message);
    }
  }

  try {
    const result = await importAsset({ originUrl, filePath: archivePath, selectedImageUrl, assetName, tags, isAdult, store });
    const scannerResults = store.get('scannerResults', []);
    store.set('scannerResults', removeScannerResult(scannerResults, archivePath));
    if (mainWindow) mainWindow.webContents.send('refresh-library', { assetId: result.assetId });
    runMalwareScanForAsset(result.assetId);
    return { ok: true, assetId: result.assetId, assetName: result.meta.name };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('scanner-cancel', () => {
  scannerCancelled = true;
  if (scannerWorker) {
    try { scannerWorker.send({ type: 'cancel' }); } catch {}
    try { scannerWorker.kill(); } catch {}
    scannerWorker = null;
  }
  return true;
});

ipcMain.handle('scanner-scan', async (event, folderPath) => {
  if (typeof folderPath !== 'string' || !fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    return { ok: false, error: 'Invalid scan folder' };
  }
  if (scannerWorker) return { ok: false, error: 'A scan is already running' };
  store.set('scannerFolder', folderPath);
  const { fork } = require('child_process');
  const COMPRESSED_EXTS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.unitypackage', '.nupkg', '.jar', '.whl', '.egg']);
  const archives = [];
  const walk = dir => {
    if (archives.length >= 10000) throw new Error('Too many archives');
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (COMPRESSED_EXTS.has(path.extname(entry.name).toLowerCase())) archives.push(full);
      if (archives.length >= 10000) throw new Error('Too many archives');
    }
  };
  try { walk(folderPath); } catch (err) { return { ok: false, error: err.message }; }
  const send = data => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scanner-progress', data); };
  const sevenZip = find7zip();
  if (!sevenZip) { send({ type: 'error', message: '7-Zip not found' }); return { ok: false }; }
  scannerCancelled = false;
  send({ type: 'found_archives', count: archives.length });
  return await new Promise(resolve => {
    const worker = fork(path.join(__dirname, 'src', 'scannerWorker.js'), [], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    scannerWorker = worker;
    let settled = false;
    const finish = result => { if (settled) return; settled = true; scannerWorker = null; try { worker.kill(); } catch {} resolve(result); };
    worker.on('message', data => {
      if (data.type === 'archive') {
        send({ type: 'scanning', current: data.archive, index: data.index, total: data.total });
        if (data.found) {
          const originEvidence = extractBoothEvidence({ archivePath: data.archive, pathnames: data.pathnames, metadataTexts: data.metadataTexts });
          const result = { archive: data.archive, content: data.found, pathnames: data.pathnames, originEvidence };
          result.origin = initialOrigin(result);
          result.selectedOriginUrl = autoSelectedCandidate(result.origin)?.url || '';
          send({ type: 'result', ...result });
        }
      } else if (data.type === 'archive_error') send(data);
      else if (data.type === 'done') { send(data); finish({ ok: true }); }
      else if (data.type === 'cancelled') { send(data); finish({ ok: false }); }
    });
    worker.on('error', err => { send({ type: 'error', message: err.message }); finish({ ok: false, error: err.message }); });
    worker.send({
      type: 'scan',
      sevenZip,
      archives,
      limits: {
        maxEntries: 5000,
        maxEntryBytes: 8 * 1024 * 1024 * 1024,
        maxArchiveBytes: 32 * 1024 * 1024 * 1024,
        archiveTimeoutMs: 60000,
        maxDepth: 4,
        maxNestedArchives: 100,
      },
    });
  });
});

// Kept temporarily for compatibility while callers migrate; it is not exposed
// through the preload bridge. Remove after the worker path is stable.
ipcMain.handle('scanner-scan-legacy', async (event, folderPath) => {
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
