// BBLM web mode — minimal local server that shares the Electron codebase.
// Run alone: node server.js --port 47823
// The desktop app also starts it in-process when Settings > Remote Access is on.
// Root folder comes from the desktop app config unless --root or BBLM_ROOT wins.
// Internet use: bind --host 0.0.0.0 and set BBLM_TOKEN (or --token).
// This keeps Electron intact. It reuses src/assetManager for the library.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseBoothItemUrl, parseBoothDownloadUrl } = require('./src/boothItemLink');
const { writeJsonAtomic } = require('./src/atomicFs');

const ROOT_DIR = __dirname;
const RENDERER_DIR = path.join(ROOT_DIR, 'renderer');
const PKG = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')); }
  catch { return { version: '0.0.0' }; }
})();

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) { out.port = Number(argv[i + 1]); i += 1; }
    else if (a === '--host' && argv[i + 1]) { out.host = argv[i + 1]; i += 1; }
    else if (a === '--root' && argv[i + 1]) { out.root = argv[i + 1]; i += 1; }
    else if (a === '--token') { out.token = argv[i + 1] || ''; out.tokenSet = true; i += 1; }
    else if (a.startsWith('--token=')) { out.token = a.slice('--token='.length); out.tokenSet = true; }
    else if (a === '--config' && argv[i + 1]) { out.config = argv[i + 1]; i += 1; }
    else if (a === '--desktop-config' && argv[i + 1]) { out.desktopConfig = argv[i + 1]; i += 1; }
  }
  return out;
}

// Minimal store with the same get/set shape as electron-store usage in src/*.
class FileStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {};
    try {
      if (fs.existsSync(filePath)) this.data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch { this.data = {}; }
  }
  get(key, def) { return this.data[key] === undefined ? def : this.data[key]; }
  has(key) { return this.data[key] !== undefined; }
  set(key, value) {
    this.data[key] = value;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (err) { console.warn('[web] store write failed:', err.message); }
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return serveHtmlWeb(res, filePath);
  const type = MIME[ext] || 'application/octet-stream';
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => { res.writeHead(404); res.end('Not found'); });
  res.writeHead(200, { 'Content-Type': type });
  stream.pipe(res);
}

// Web pages fetch /api/*, but the Electron CSP sets connect-src 'none'.
// Patch that one directive for browser serving. Electron files stay unchanged.
function serveHtmlWeb(res, filePath) {
  let html = null;
  try { html = fs.readFileSync(filePath, 'utf8'); } catch { res.writeHead(404); res.end('Not found'); return; }
  html = html.replace("connect-src 'none'", "connect-src 'self'");
  const body = Buffer.from(html, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

function safeJoin(base, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const joined = path.normalize(path.join(base, decoded));
  if (joined !== base && !joined.startsWith(base + path.sep)) return null;
  return joined;
}

function isValidAssetId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(id);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 256 * 1024) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const DEFAULT_LOG = (level, message) => {
  if (level === 'warn') console.warn(message);
  else console.log(message);
};

// Builds one server instance with its own stores, scan state and request
// handler. The desktop app runs this in-process; server.js runs it from a CLI.
function createWebServer(options = {}) {
  const port = options.port === 0 ? 0 : (Number(options.port) || 47823);
  const host = options.host || '127.0.0.1';
  const token = typeof options.token === 'string' ? options.token : '';
  const log = typeof options.log === 'function' ? options.log : DEFAULT_LOG;
  const configPath = options.configPath || path.join(ROOT_DIR, 'data', 'bblm-web-config.json');
  const webConfig = new FileStore(configPath);
  const desktop = options.desktopStore || { get: (key, def) => def };
  const desktopFound = options.desktopFound !== false;
  const fixedRoot = typeof options.rootFolder === 'string' ? options.rootFolder : '';
  const fixedRootSource = options.rootSource || 'option';
  // Set by the desktop app. Without it, Booth link downloads report that the
  // desktop app is needed.
  const onDownloadRequest = typeof options.onDownloadRequest === 'function' ? options.onDownloadRequest : null;

  // ── Booth Free Items scan state ───────────────────────────────────────────
  // Same scrapeFreeItems engine as the desktop app. Browsers poll
  // GET /api/free-items/events for progress + found items (no WebSocket yet).
  // Web scan results live in the web config; reads merge desktop + web.
  const freeScan = { running: false, cancelled: false, events: [], cursor: 0 };

  function pushFreeEvent(type, data) {
    freeScan.cursor += 1;
    freeScan.events.push({ i: freeScan.cursor, type, data });
    if (freeScan.events.length > 500) freeScan.events.splice(0, freeScan.events.length - 500);
  }

  function mergedFreeList(key) {
    const seen = new Set();
    const out = [];
    for (const layer of [desktop.get(key, []), webConfig.get(key, [])]) {
      if (!Array.isArray(layer)) continue;
      for (const item of layer) {
        const id = item && (item.itemId !== undefined ? item.itemId : item.assetId);
        if (id === undefined || seen.has(id)) continue;
        seen.add(id);
        out.push(item);
      }
    }
    return out;
  }

  // Re-read on every call so a root-folder change in Settings applies live.
  function resolveRoot() {
    if (fixedRoot) return { rootFolder: fixedRoot, source: fixedRootSource };
    const fromWeb = webConfig.get('rootFolder', '');
    if (fromWeb) return { rootFolder: fromWeb, source: 'web-config' };
    return { rootFolder: desktop.get('rootFolder', '') || '', source: 'desktop' };
  }

  const store = {
    get: (key, def) => {
      if (key === 'rootFolder') return resolveRoot().rootFolder || def;
      return webConfig.has(key) ? webConfig.get(key, def) : desktop.get(key, def);
    },
    set: (key, value) => webConfig.set(key, value),
  };

  const { getAssets } = require('./src/assetManager');
  const { displayTitle } = require('./src/titleTranslations');

  // ── Malware acknowledgement (web) ─────────────────────────────────────────
  // The scan popup asks the user to mark an asset safe or unsafe. The desktop
  // app writes the answer to meta.json over IPC; web mode must do the same or
  // the popup returns on every page load.
  function applyMalwareAcknowledgement(assetId, markedSafe) {
    if (!isValidAssetId(assetId)) return { ok: false, error: 'Bad asset id', status: 400 };
    const { resolveExistingAssetDir } = require('./src/security/pathPolicy');
    let assetDir;
    try { assetDir = resolveExistingAssetDir(store.get('rootFolder', ''), assetId); }
    catch (err) { return { ok: false, error: err.message || 'Asset not found', status: 404 }; }

    const metaPath = path.join(assetDir, 'meta.json');
    let meta;
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
    catch { return { ok: false, error: 'Asset metadata not found', status: 404 }; }
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      return { ok: false, error: 'Asset metadata is invalid', status: 500 };
    }

    // Same rule as the desktop app: Critical findings must be marked unsafe.
    if (markedSafe && meta.scanStatus === 'critical') {
      return { ok: false, error: 'Critical findings must be marked unsafe', status: 409 };
    }

    meta.scanMarkedSafe = markedSafe === true;
    meta.scanAcknowledged = true;
    writeJsonAtomic(metaPath, meta);
    const { touchIndexEntry } = require('./src/assetManager');
    touchIndexEntry(store, assetId, meta);
    return { ok: true, scanAcknowledged: true, scanMarkedSafe: meta.scanMarkedSafe };
  }

  async function runFreeItemsScanWeb() {
    if (freeScan.running) return;
    freeScan.running = true;
    freeScan.cancelled = false;
    pushFreeEvent('progress', { phase: 'started' });
    webConfig.set('foundFreeItems', []);
    try {
      const { scrapeFreeItems } = require('./src/boothFreeScraper');
      const result = await scrapeFreeItems({
        maxPages: store.get('freeItemsMaxPages', 5),
        isCancelled: () => freeScan.cancelled,
        onProgress: (data) => pushFreeEvent('progress', data),
        onItem: (item) => {
          const existing = webConfig.get('foundFreeItems', []);
          if (!existing.find((e) => e.itemId === item.itemId)) {
            webConfig.set('foundFreeItems', [...existing, item]);
          }
          pushFreeEvent('found', item);
        },
      });
      pushFreeEvent('progress', { phase: 'done', ...result });
    } catch (err) {
      pushFreeEvent('progress', { phase: 'error', message: err.message });
    } finally {
      freeScan.running = false;
    }
  }

  // ── Booth download requests ───────────────────────────────────────────────
  // A browser has no Booth session and no file access, so it cannot download by
  // itself. The page sends a Booth item link or a Booth download deeplink here
  // and the desktop app resolves it and queues the file. The page polls the
  // state of its request. Without a desktop hook (plain `node server.js`) the
  // routes report that the desktop app is needed.
  const DOWNLOAD_REQUEST_LIMIT = 20;
  const DOWNLOAD_STATES = new Set(['resolving', 'queued', 'downloading', 'done', 'error']);
  const ACTIVE_DOWNLOAD_LIMIT = 5;
  const STALE_DOWNLOAD_MS = 15 * 60 * 1000;
  const downloadRequests = new Map();
  let downloadRequestSeq = 0;

  function publicDownloadRequest(request) {
    return {
      id: request.id,
      kind: request.kind,
      itemId: request.itemId,
      itemUrl: request.itemUrl,
      state: request.state,
      percent: request.percent,
      parts: request.parts,
      error: request.error,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  // Only the known fields are applied, so a desktop update cannot inject data.
  function applyDownloadUpdate(request, patch) {
    if (!patch || typeof patch !== 'object') return;
    if (DOWNLOAD_STATES.has(patch.state)) request.state = patch.state;
    if (Number.isFinite(Number(patch.percent))) {
      request.percent = Math.max(0, Math.min(100, Math.round(Number(patch.percent))));
    }
    if (Number.isFinite(Number(patch.parts))) {
      request.parts = Math.max(1, Math.min(50, Math.round(Number(patch.parts))));
    }
    if (typeof patch.error === 'string') request.error = patch.error.slice(0, 300);
    request.updatedAt = Date.now();
  }

  // kind is 'item' (a Booth item page link) or 'deeplink' (a Booth download
  // link). The desktop app answers after the Booth page is read, which can take
  // a while, so the HTTP reply does not wait for it.
  function beginDownloadRequest({ kind, itemId = '', itemUrl = '', url = '' }) {
    downloadRequestSeq += 1;
    const now = Date.now();
    const request = {
      id: `d${downloadRequestSeq}`,
      kind,
      itemId,
      itemUrl,
      state: 'resolving',
      percent: 0,
      parts: 1,
      error: '',
      createdAt: now,
      updatedAt: now,
    };
    downloadRequests.set(request.id, request);
    trimDownloadRequests();

    Promise.resolve()
      .then(() => onDownloadRequest({
        kind,
        itemId,
        itemUrl,
        url,
        update: (patch) => applyDownloadUpdate(request, patch),
      }))
      .catch((err) => applyDownloadUpdate(request, { state: 'error', error: err.message }));

    return request;
  }

  function downloadBusyResponse(res) {
    return sendJson(res, { ok: false, error: 'Too many downloads are waiting. Try again in a moment.' }, 429);
  }

  function activeDownloadCount() {
    const now = Date.now();
    let count = 0;
    for (const request of downloadRequests.values()) {
      if (request.state === 'done' || request.state === 'error') continue;
      // A request the desktop never finished must not block new ones.
      if (now - request.updatedAt > STALE_DOWNLOAD_MS) continue;
      count += 1;
    }
    return count;
  }

  function trimDownloadRequests() {
    // Keep the request list bounded. The oldest finished entries go first.
    while (downloadRequests.size > DOWNLOAD_REQUEST_LIMIT) {
      const oldest = downloadRequests.keys().next();
      if (oldest.done) return;
      downloadRequests.delete(oldest.value);
    }
  }

  // Optional shared token for internet use. The browser shim sends it back
  // as a header (or ?token=). Without it, /api/* returns 401.
  function isAuthorized(url, req) {
    if (!token) return true;
    if (req.headers['x-bblm-token'] === token) return true;
    return url.searchParams.get('token') === token;
  }

  async function handleRequest(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, { ok: true, mode: 'web', version: PKG.version });
    }

    if (url.pathname.startsWith('/api/') && !isAuthorized(url, req)) {
      return sendJson(res, { error: 'Unauthorized' }, 401);
    }

    // ── Booth Free Items ──────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/free-items/config') {
      return sendJson(res, {
        enabled: store.get('freeItemsEnabled', true),
        interval: store.get('freeItemsInterval', 6),
        maxPages: store.get('freeItemsMaxPages', 5),
      });
    }

    if ((req.method === 'PUT' || req.method === 'POST') && url.pathname === '/api/free-items/config') {
      try {
        const body = await readJsonBody(req);
        if (body.enabled !== undefined) store.set('freeItemsEnabled', !!body.enabled);
        if (Number.isFinite(Number(body.interval))) store.set('freeItemsInterval', Number(body.interval));
        if (Number.isFinite(Number(body.maxPages))) {
          store.set('freeItemsMaxPages', Math.max(1, Math.min(20, Number(body.maxPages))));
        }
        return sendJson(res, { ok: true });
      } catch (err) { return sendJson(res, { error: err.message }, 400); }
    }

    if (req.method === 'GET' && url.pathname === '/api/free-items/found') {
      return sendJson(res, mergedFreeList('foundFreeItems'));
    }

    if (req.method === 'GET' && url.pathname === '/api/free-items/downloaded') {
      return sendJson(res, mergedFreeList('downloadedFreeItems'));
    }

    if (req.method === 'GET' && url.pathname === '/api/free-items/library-ids') {
      try {
        const { getAssets } = require('./src/assetManager');
        const ids = getAssets(store)
          .map((a) => { const m = (a.originUrl || '').match(/\/items\/(\d+)/); return m ? parseInt(m[1], 10) : null; })
          .filter(Boolean);
        return sendJson(res, ids);
      } catch (err) { return sendJson(res, { error: err.message }, 500); }
    }

    if (req.method === 'GET' && url.pathname === '/api/free-items/events') {
      const since = Number(url.searchParams.get('since') || 0);
      return sendJson(res, {
        cursor: freeScan.cursor,
        running: freeScan.running,
        events: freeScan.events.filter((e) => e.i > since),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/free-items/scan') {
      if (freeScan.running) return sendJson(res, { ok: false, error: 'already running' });
      runFreeItemsScanWeb();
      return sendJson(res, { ok: true, started: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/free-items/stop') {
      freeScan.cancelled = true;
      return sendJson(res, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/free-items/download') {
      try {
        const body = await readJsonBody(req);
        let link;
        try { link = parseBoothDownloadUrl(body && body.url); } catch (err) { return sendJson(res, { ok: false, error: err.message }, 400); }
        if (typeof onDownloadRequest !== 'function') {
          return sendJson(res, {
            ok: false,
            error: "Downloads need the desktop app. Open BB's LibMan and turn on Remote Access.",
          }, 501);
        }
        if (activeDownloadCount() >= ACTIVE_DOWNLOAD_LIMIT) return downloadBusyResponse(res);
        // Same deeplink the desktop app opens: the desktop app catches the
        // booth-library-manager:// redirect and queues the file.
        const request = beginDownloadRequest({ kind: 'deeplink', url: link.url });
        return sendJson(res, { ok: true, request: publicDownloadRequest(request) }, 202);
      } catch (err) { return sendJson(res, { ok: false, error: err.message }, 400); }
    }

    // ── Booth link downloads (web → desktop) ──────────────────────────────
    if (req.method === 'POST' && url.pathname === '/api/download') {
      let body;
      try { body = await readJsonBody(req); } catch (err) { return sendJson(res, { ok: false, error: err.message }, 400); }

      // A Booth item page link, or a Booth download deeplink.
      let link;
      try {
        const item = parseBoothItemUrl(body && body.url);
        link = { kind: 'item', itemId: item.itemId, itemUrl: item.itemUrl };
      } catch (itemError) {
        try {
          const deeplink = parseBoothDownloadUrl(body && body.url);
          link = { kind: 'deeplink', url: deeplink.url };
        } catch {
          return sendJson(res, { ok: false, error: itemError.message }, 400);
        }
      }

      if (typeof onDownloadRequest !== 'function') {
        return sendJson(res, {
          ok: false,
          error: "Downloads need the desktop app. Open BB's LibMan and turn on Remote Access.",
        }, 501);
      }
      if (activeDownloadCount() >= ACTIVE_DOWNLOAD_LIMIT) return downloadBusyResponse(res);

      const request = beginDownloadRequest({
        kind: link.kind,
        itemId: link.itemId || '',
        itemUrl: link.itemUrl || '',
        url: link.url || '',
      });
      return sendJson(res, { ok: true, request: publicDownloadRequest(request) }, 202);
    }

    if (req.method === 'GET' && url.pathname === '/api/download/status') {
      const id = url.searchParams.get('id') || '';
      if (id) {
        const request = downloadRequests.get(id);
        if (!request) return sendJson(res, { ok: false, error: 'Unknown download request' }, 404);
        return sendJson(res, { ok: true, request: publicDownloadRequest(request) });
      }
      const requests = [...downloadRequests.values()].map(publicDownloadRequest).reverse();
      return sendJson(res, { ok: true, requests });
    }

    // ── Malware acknowledgement (web page → asset meta.json) ──────────────
    const ackMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/malware-acknowledge$/);
    if (req.method === 'POST' && ackMatch) {
      let assetId = '';
      try { assetId = decodeURIComponent(ackMatch[1]); }
      catch { return sendJson(res, { ok: false, error: 'Bad asset id' }, 400); }
      let body;
      try { body = await readJsonBody(req); }
      catch (err) { return sendJson(res, { ok: false, error: err.message }, 400); }
      const result = applyMalwareAcknowledgement(assetId, body && body.markedSafe === true);
      return sendJson(res, result, result.ok ? 200 : (result.status || 400));
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      const root = resolveRoot();
      return sendJson(res, {
        appVersion: PKG.version,
        webMode: true,
        rootFolder: root.rootFolder,
        rootFolderSource: root.source,
        desktopFound,
        translatedTitlesEnabled: store.get('translatedTitlesEnabled', false),
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/assets') {
      try {
        const hidden = store.get('hiddenAssets', []);
        const assets = getAssets(store)
          .filter((a) => !hidden.includes(a.id) && !a.freeItemPending)
          .map((a) => {
            const hasThumb = Boolean(a.thumbnail) || Boolean(a.thumbnailPath);
            return {
              ...a,
              displayName: displayTitle(a, store.get('translatedTitlesEnabled', false)),
              // Web UI uses HTTP thumbs. Electron keeps file:// paths.
              thumbnailPath: '',
              thumbnailUrl: hasThumb && isValidAssetId(a.id) ? `/api/thumbs/${encodeURIComponent(a.id)}` : (a.thumbnailUrl || ''),
            };
          });
        return sendJson(res, assets);
      } catch (err) {
        return sendJson(res, { error: err.message }, 500);
      }
    }

    const thumbMatch = url.pathname.match(/^\/api\/thumbs\/([^/]+)$/);
    if (req.method === 'GET' && thumbMatch) {
      const assetId = decodeURIComponent(thumbMatch[1]);
      if (!isValidAssetId(assetId)) { res.writeHead(400); res.end('Bad id'); return; }
      try {
        const { resolveExistingAssetDir } = require('./src/security/pathPolicy');
        const root = store.get('rootFolder', '');
        const dir = resolveExistingAssetDir(root, assetId);
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
        const thumbName = typeof meta.thumbnail === 'string' ? path.basename(meta.thumbnail) : 'thumbnail.png';
        const file = path.join(dir, thumbName);
        if (!fs.existsSync(file)) { res.writeHead(404); res.end('No thumbnail'); return; }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
        fs.createReadStream(file).pipe(res);
      } catch { res.writeHead(404); res.end('Not found'); }
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return serveFile(res, path.join(RENDERER_DIR, 'index.html'));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/renderer/')) {
      const file = safeJoin(ROOT_DIR, url.pathname);
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
      return serveFile(res, file);
    }

    // index.html uses relative paths like "styles.css" and "app.js".
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const file = safeJoin(ROOT_DIR, url.pathname);
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
      return serveFile(res, file);
    }

    // Tolerate relative asset URLs from renderer/ when served at "/".
    if (req.method === 'GET') {
      const file = safeJoin(RENDERER_DIR, url.pathname);
      if (file && fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file);
    }

    res.writeHead(404);
    res.end('Not found');
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      log('warn', `[web] request failed: ${err.message}`);
      if (!res.headersSent) { res.writeHead(500); res.end('Server error'); }
      else res.end();
    });
  });

  function listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => { server.removeListener('listening', onListening); reject(error); };
      const onListening = () => { server.removeListener('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  function close() {
    return new Promise((resolve) => {
      if (!server.listening) { resolve(); return; }
      server.close(() => resolve());
      // Drop keep-alive sockets so stop is immediate.
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
  }

  function getInfo() {
    const address = server.address();
    const boundPort = address && typeof address === 'object' ? address.port : port;
    const root = resolveRoot();
    return { host, port: boundPort, rootFolder: root.rootFolder, rootFolderSource: root.source, desktopFound };
  }

  return { server, listen, close, getInfo, store };
}

async function startWebServer(options = {}) {
  const instance = createWebServer(options);
  await instance.listen();
  return instance;
}

async function main() {
  const args = parseArgs(process.argv);
  const port = args.port || Number(process.env.BBLM_PORT) || 47823;
  const host = args.host || process.env.BBLM_HOST || '127.0.0.1';
  // Explicit --token (even empty) wins over the environment.
  const token = args.tokenSet ? (args.token || '') : (process.env.BBLM_TOKEN || '');
  const configPath = args.config || process.env.BBLM_CONFIG || path.join(ROOT_DIR, 'data', 'bblm-web-config.json');

  // Same data as the desktop app: the desktop config is the base layer.
  // Web overrides (CLI, env, web config file) win when set.
  const { DesktopStore } = require('./src/desktopStore');
  const desktop = new DesktopStore(args.desktopConfig);
  if (args.root) new FileStore(configPath).set('rootFolder', args.root);

  // Root folder: CLI wins, then env, then web config, then desktop app.
  const rootFolder = args.root || process.env.BBLM_ROOT || '';
  const rootSource = args.root ? 'cli' : (process.env.BBLM_ROOT ? 'env' : 'desktop');

  const instance = await startWebServer({
    port,
    host,
    token,
    configPath,
    desktopStore: desktop,
    desktopFound: desktop.found,
    rootFolder,
    rootSource,
    log: (level, message) => {
      if (level === 'warn') console.warn(message);
      else console.log(message);
    },
  });

  const info = instance.getInfo();
  console.log(`[web] BBLM web mode on http://${info.host}:${info.port}/`);
  console.log(`[web] rootFolder: ${info.rootFolder || '(not set)'} (source: ${info.rootFolderSource}, desktop config: ${info.desktopFound ? 'found' : 'not found'})`);
  if (!info.rootFolder) console.log('[web] No library found. Set it with --root, BBLM_ROOT, or the desktop app Settings.');
  if (host === '0.0.0.0' || host === '::') {
    console.log('[web] WARNING: listening on all interfaces. Set BBLM_TOKEN to require a shared token.');
  }
  if (!token) console.log('[web] No BBLM_TOKEN set. Anyone with access to the port can read the library.');

  const stop = () => { instance.close().then(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) {
  main().catch((err) => { console.error('[web] fatal:', err); process.exit(1); });
}

module.exports = { createWebServer, startWebServer };
