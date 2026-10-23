'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LibraryWebServer, DEFAULT_PORT, normalizePort } = require('../src/webServer');

class MemoryStore {
  constructor(data = {}) { this.data = data; }
  get(key, def) { return this.data[key] === undefined ? def : this.data[key]; }
  set(key, value) { this.data[key] = value; }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function fetchConfig(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/config', headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

test('port values fall back to the default when out of range', () => {
  assert.equal(DEFAULT_PORT, 47823);
  assert.equal(normalizePort(0), DEFAULT_PORT);
  assert.equal(normalizePort(70000), DEFAULT_PORT);
  assert.equal(normalizePort('abc'), DEFAULT_PORT);
  assert.equal(normalizePort(9090), 9090);
});

test('the server starts only when enabled and follows live settings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bblm-web-life-'));
  const port = await freePort();
  const store = new MemoryStore({ webServerEnabled: false, webServerPort: port, rootFolder: 'D:\\Library' });
  const web = new LibraryWebServer({ store, configPath: path.join(dir, 'web.json') });

  assert.equal(web.status().running, false);
  await web.apply();
  assert.equal(web.status().running, false);

  store.set('webServerEnabled', true);
  const started = await web.apply();
  assert.equal(started.running, true);
  assert.equal(started.port, port);
  assert.ok(started.urls.some((url) => url === `http://localhost:${port}/`));

  // Library changes in the desktop store are visible without a restart.
  store.set('rootFolder', 'D:\\Other');
  const config = await fetchConfig(port);
  assert.equal(config.status, 200);
  assert.equal(JSON.parse(config.body).rootFolder, 'D:\\Other');

  store.set('webServerEnabled', false);
  const stopped = await web.apply();
  assert.equal(stopped.running, false);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a port conflict is reported as a user-facing error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bblm-web-conflict-'));
  const blocker = http.createServer();
  await new Promise((resolve) => blocker.listen(0, '0.0.0.0', resolve));
  const { port } = blocker.address();

  const store = new MemoryStore({ webServerEnabled: true, webServerPort: port });
  const web = new LibraryWebServer({ store, configPath: path.join(dir, 'web.json') });
  const status = await web.apply();

  assert.equal(status.running, false);
  assert.match(status.error, /already in use/);

  await new Promise((resolve) => blocker.close(resolve));
  await web.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the configured token protects API requests from the app server', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bblm-web-token-'));
  const port = await freePort();
  const store = new MemoryStore({ webServerEnabled: true, webServerPort: port, webServerToken: 'app-token' });
  const web = new LibraryWebServer({ store, configPath: path.join(dir, 'web.json') });
  await web.apply();

  const denied = await fetchConfig(port);
  assert.equal(denied.status, 401);
  const allowed = await fetchConfig(port, { 'x-bblm-token': 'app-token' });
  assert.equal(allowed.status, 200);

  await web.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});
