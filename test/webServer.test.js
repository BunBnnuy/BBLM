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

test('an access token protects API routes but not the page shell', async () => {
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

  const denied = await request(port, '/api/config');
  assert.equal(denied.status, 401);

  const allowed = await request(port, '/api/config', { 'x-bblm-token': 's3cret' });
  assert.equal(allowed.status, 200);
  assert.equal(JSON.parse(allowed.body).webMode, true);

  const queryToken = await request(port, '/api/config?token=s3cret');
  assert.equal(queryToken.status, 200);

  const page = await request(port, '/');
  assert.equal(page.status, 200);

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
