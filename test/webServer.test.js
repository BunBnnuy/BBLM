'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { startWebServer } = require('../server');

function request(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

function postJson(port, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function temporaryConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bblm-web-'));
  return { dir, configPath: path.join(dir, 'web-config.json') };
}

test('web server serves the library shell and stops cleanly', async () => {
  const { dir, configPath } = temporaryConfig();
  const instance = await startWebServer({
    port: 0,
    host: '127.0.0.1',
    configPath,
    desktopStore: { get: (key, def) => def },
    log: () => {},
  });
  const { port } = instance.getInfo();
  assert.ok(port > 0);

  const health = await request(port, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).ok, true);

  const page = await request(port, '/');
  assert.equal(page.status, 200);
  // Web pages need same-origin fetch for /api/*.
  assert.match(page.body, /connect-src 'self'/);

  await instance.close();
  await assert.rejects(request(port, '/api/health'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an access token keeps the library view public and protects the rest', async () => {
  const { dir, configPath } = temporaryConfig();
  const instance = await startWebServer({
    port: 0,
    host: '127.0.0.1',
    token: 's3cret',
    configPath,
    desktopStore: { get: (key, def) => def },
    log: () => {},
  });
  const { port } = instance.getInfo();

  // The library view: page shell, styles, asset list and thumbnails.
  const page = await request(port, '/');
  assert.equal(page.status, 200);
  assert.equal((await request(port, '/styles.css')).status, 200);
  const assets = await request(port, '/api/assets');
  assert.equal(assets.status, 200);
  assert.deepEqual(JSON.parse(assets.body), []);
  // A thumbnail for an unknown asset is still a public route, so it is a 404.
  assert.equal((await request(port, '/api/thumbs/unknown-asset')).status, 404);
  assert.equal(JSON.parse((await request(port, '/api/health')).body).tokenRequired, true);

  // Downloads, Free Items and configuration need the token.
  assert.equal((await request(port, '/api/config')).status, 401);
  assert.equal((await request(port, '/api/free-items/found')).status, 401);
  assert.equal((await request(port, '/api/free-items/config')).status, 401);
  assert.equal((await postJson(port, '/api/free-items/scan', {})).status, 401);
  assert.equal((await postJson(port, '/api/download', { url: 'https://booth.pm/en/items/1' })).status, 401);

  // Settings is a gated page: without the token it answers with the unlock form.
  const lockedSettings = await request(port, '/settings.html');
  assert.equal(lockedSettings.status, 401);
  assert.match(lockedSettings.body, /Access token required/);
  const openSettings = await request(port, '/settings.html?token=s3cret');
  assert.equal(openSettings.status, 200);
  assert.match(openSettings.body, /Remote Access/);

  const allowed = await request(port, '/api/config', { 'x-bblm-token': 's3cret' });
  assert.equal(allowed.status, 200);
  assert.equal(JSON.parse(allowed.body).webMode, true);

  const queryToken = await request(port, '/api/config?token=s3cret');
  assert.equal(queryToken.status, 200);

  await instance.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('marking an item safe or unsafe in web mode is saved', async () => {
  const { dir, configPath } = temporaryConfig();
  const root = path.join(dir, 'library');
  const writeAsset = (id, meta) => {
    const assetDir = path.join(root, id);
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, 'meta.json'), JSON.stringify({
      id,
      name: `Asset ${id}`,
      importedAt: new Date().toISOString(),
      files: [],
      scanAcknowledged: false,
      scanMarkedSafe: false,
      ...meta,
    }));
  };
  writeAsset('asset-high', { scanStatus: 'high' });
  writeAsset('asset-critical', { scanStatus: 'critical' });

  const desktopStore = { data: { rootFolder: root }, get(key, def) { return this.data[key] === undefined ? def : this.data[key]; } };
  const instance = await startWebServer({
    port: 0,
    host: '127.0.0.1',
    configPath,
    desktopStore,
    log: () => {},
  });
  const { port } = instance.getInfo();

  const before = JSON.parse((await request(port, '/api/assets')).body);
  assert.equal(before.find((a) => a.id === 'asset-high').scanAcknowledged, false);

  // "Mark as unsafe" must survive a reload, so it is written to meta.json.
  const marked = await postJson(port, '/api/assets/asset-high/malware-acknowledge', { markedSafe: false });
  assert.equal(marked.status, 200);
  assert.equal(JSON.parse(marked.body).scanAcknowledged, true);

  const after = JSON.parse((await request(port, '/api/assets')).body);
  assert.equal(after.find((a) => a.id === 'asset-high').scanAcknowledged, true);

  const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'asset-high', 'meta.json'), 'utf8'));
  assert.equal(onDisk.scanAcknowledged, true);
  assert.equal(onDisk.scanMarkedSafe, false);

  // Critical findings can never be waved off as safe, but "unsafe" works.
  const tooSafe = await postJson(port, '/api/assets/asset-critical/malware-acknowledge', { markedSafe: true });
  assert.equal(tooSafe.status, 409);
  const critical = JSON.parse((await request(port, '/api/assets')).body).find((a) => a.id === 'asset-critical');
  assert.equal(critical.scanAcknowledged, false);
  const criticalUnsafe = await postJson(port, '/api/assets/asset-critical/malware-acknowledge', { markedSafe: false });
  assert.equal(criticalUnsafe.status, 200);

  const missing = await postJson(port, '/api/assets/does-not-exist/malware-acknowledge', { markedSafe: false });
  assert.equal(missing.status, 404);

  await instance.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a busy port rejects so the app can report the conflict', async () => {
  const { dir, configPath } = temporaryConfig();
  const first = await startWebServer({
    port: 0,
    host: '127.0.0.1',
    configPath,
    desktopStore: { get: (key, def) => def },
    log: () => {},
  });
  const { port } = first.getInfo();

  await assert.rejects(startWebServer({
    port,
    host: '127.0.0.1',
    configPath,
    desktopStore: { get: (key, def) => def },
    log: () => {},
  }), (error) => error.code === 'EADDRINUSE');

  await first.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
