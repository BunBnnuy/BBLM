'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseBoothItemUrl, parseBoothDownloadUrl } = require('../src/boothItemLink');
const { startWebServer } = require('../server');

function request(port, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const allHeaders = { ...headers };
    if (payload) {
      allHeaders['Content-Type'] = 'application/json';
      allHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: allHeaders }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { json = null; }
        resolve({ status: res.statusCode, body: raw, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function temporaryConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bblm-web-download-'));
  return { dir, configPath: path.join(dir, 'web-config.json') };
}

function serverOptions(configPath, extra = {}) {
  return {
    port: 0,
    host: '127.0.0.1',
    configPath,
    desktopStore: { get: (key, fallback) => fallback },
    log: () => {},
    ...extra,
  };
}

test('Booth item links parse to a canonical item URL', () => {
  const cases = [
    ['https://booth.pm/en/items/1234567', '1234567'],
    ['https://booth.pm/ja/items/42', '42'],
    ['https://booth.pm/items/9/', '9'],
    ['  https://shop.booth.pm/items/8725457?foo=1#download  ', '8725457'],
  ];
  for (const [input, itemId] of cases) {
    const link = parseBoothItemUrl(input);
    assert.equal(link.itemId, itemId);
    assert.equal(link.itemUrl, `https://booth.pm/en/items/${itemId}`);
  }
});

test('Booth item links reject other hosts, other pages and unsafe forms', () => {
  const rejected = [
    '',
    '   ',
    null,
    'http://booth.pm/en/items/1',
    'https://booth.pm.evil.example/en/items/1',
    'https://notbooth.example/en/items/1',
    'https://booth.pm/en/shops/1',
    'https://booth.pm/en/items/1/extra',
    'https://booth.pm/downloadables/1/deeplink?client=booth-library-manager',
    'javascript:alert(1)',
    'https://user:pass@booth.pm/en/items/1',
    `https://booth.pm/en/items/${'9'.repeat(21)}`,
    `https://booth.pm/en/items/1?${'a'.repeat(2100)}`,
  ];
  for (const input of rejected) {
    assert.throws(() => parseBoothItemUrl(input), Error, `accepted: ${String(input).slice(0, 60)}`);
  }
});

test('Booth download deeplinks parse and reject other pages', () => {
  const deeplink = 'https://booth.pm/downloadables/12345/deeplink?client=booth-library-manager&item_id=99&downloadable_filename=pack.zip';
  assert.equal(parseBoothDownloadUrl(deeplink).url, deeplink);
  assert.ok(parseBoothDownloadUrl('https://shop.booth.pm/downloadables/1/deeplink?client=booth-library-manager'));

  const rejected = [
    '',
    'https://booth.pm/en/items/123',
    'https://booth.pm/downloadables/12345/other',
    'http://booth.pm/downloadables/1/deeplink',
    'https://example.com/downloadables/1/deeplink',
    'javascript:alert(1)',
    null,
  ];
  for (const input of rejected) {
    assert.throws(() => parseBoothDownloadUrl(input), Error, `accepted: ${String(input).slice(0, 60)}`);
  }
});

test('Booth link downloads need the desktop app', async () => {
  const { dir, configPath } = temporaryConfig();
  const instance = await startWebServer(serverOptions(configPath));
  const { port } = instance.getInfo();

  const result = await request(port, 'POST', '/api/download', { url: 'https://booth.pm/en/items/123' });
  assert.equal(result.status, 501);
  assert.equal(result.json.ok, false);
  assert.match(result.json.error, /desktop app/i);

  await instance.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a Booth link is sent to the desktop app and its state can be read back', async () => {
  const { dir, configPath } = temporaryConfig();
  const seen = [];
  const instance = await startWebServer(serverOptions(configPath, {
    onDownloadRequest: async (request) => { seen.push(request); },
  }));
  const { port } = instance.getInfo();

  const accepted = await request(port, 'POST', '/api/download', { url: 'https://booth.pm/ja/items/555' });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.json.ok, true);
  assert.equal(accepted.json.request.itemId, '555');
  assert.equal(accepted.json.request.state, 'resolving');

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'item');
  assert.equal(seen[0].itemId, '555');
  assert.equal(seen[0].itemUrl, 'https://booth.pm/en/items/555');

  const id = accepted.json.request.id;
  seen[0].update({ state: 'downloading', percent: 42.4, parts: 2 });
  const downloading = await request(port, 'GET', `/api/download/status?id=${id}`);
  assert.equal(downloading.status, 200);
  assert.equal(downloading.json.request.state, 'downloading');
  assert.equal(downloading.json.request.percent, 42);
  assert.equal(downloading.json.request.parts, 2);

  seen[0].update({ state: 'error', error: 'Booth login expired' });
  const failed = await request(port, 'GET', `/api/download/status?id=${id}`);
  assert.equal(failed.json.request.state, 'error');
  assert.equal(failed.json.request.error, 'Booth login expired');

  const list = await request(port, 'GET', '/api/download/status');
  assert.equal(list.json.requests.length, 1);
  assert.equal(list.json.requests[0].id, id);

  const missing = await request(port, 'GET', '/api/download/status?id=d999');
  assert.equal(missing.status, 404);

  await instance.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a download request that throws is reported as an error', async () => {
  const { dir, configPath } = temporaryConfig();
  const instance = await startWebServer(serverOptions(configPath, {
    onDownloadRequest: () => { throw new Error('Booth is closed'); },
  }));
  const { port } = instance.getInfo();

  const accepted = await request(port, 'POST', '/api/download', { url: 'https://booth.pm/en/items/77' });
  assert.equal(accepted.status, 202);
  await new Promise((resolve) => setImmediate(resolve));

  const status = await request(port, 'GET', `/api/download/status?id=${accepted.json.request.id}`);
  assert.equal(status.json.request.state, 'error');
  assert.equal(status.json.request.error, 'Booth is closed');

  await instance.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Free Items download buttons work from the web through the desktop app', async () => {
  const { dir, configPath } = temporaryConfig();
  const seen = [];
  const deeplink = 'https://booth.pm/downloadables/777/deeplink?client=booth-library-manager&item_id=777';

  // Without the desktop app the row reports why it cannot download.
  const standalone = await startWebServer(serverOptions(configPath));
  const standalonePort = standalone.getInfo().port;
  const refused = await request(standalonePort, 'POST', '/api/free-items/download', { url: deeplink });
  assert.equal(refused.status, 501);
  assert.match(refused.json.error, /desktop app/i);
  await standalone.close();

  const instance = await startWebServer(serverOptions(configPath, {
    onDownloadRequest: async (req) => { seen.push(req); },
  }));
  const { port } = instance.getInfo();

  const accepted = await request(port, 'POST', '/api/free-items/download', { url: deeplink });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.json.ok, true);
  assert.equal(accepted.json.request.kind, 'deeplink');
  assert.equal(accepted.json.request.state, 'resolving');

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'deeplink');
  assert.equal(seen[0].url, deeplink);

  seen[0].update({ state: 'downloading', percent: 30 });
  const status = await request(port, 'GET', `/api/download/status?id=${accepted.json.request.id}`);
  assert.equal(status.json.request.state, 'downloading');
  assert.equal(status.json.request.percent, 30);

  const invalid = await request(port, 'POST', '/api/free-items/download', { url: 'https://booth.pm/en/items/1' });
  assert.equal(invalid.status, 400);

  await instance.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the link box also accepts a Booth download deeplink', async () => {
  const { dir, configPath } = temporaryConfig();
  const seen = [];
  const instance = await startWebServer(serverOptions(configPath, {
    onDownloadRequest: async (req) => { seen.push(req); },
  }));
  const { port } = instance.getInfo();

  const deeplink = 'https://booth.pm/downloadables/5/deeplink?client=booth-library-manager&item_id=5';
  const accepted = await request(port, 'POST', '/api/download', { url: deeplink });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.json.request.kind, 'deeplink');

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen[0].kind, 'deeplink');
  assert.equal(seen[0].url, deeplink);

  await instance.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the download route validates the link, the token and the queue length', async () => {
  const { dir, configPath } = temporaryConfig();
  const instance = await startWebServer(serverOptions(configPath, {
    token: 's3cret',
    onDownloadRequest: () => new Promise(() => {}),
  }));
  const { port } = instance.getInfo();

  const unauthorized = await request(port, 'POST', '/api/download', { url: 'https://booth.pm/en/items/1' });
  assert.equal(unauthorized.status, 401);

  const headers = { 'x-bblm-token': 's3cret' };
  const invalid = await request(port, 'POST', '/api/download', { url: 'https://example.com/items/1' }, headers);
  assert.equal(invalid.status, 400);
  assert.ok(invalid.json.error);

  for (let i = 0; i < 5; i += 1) {
    const accepted = await request(port, 'POST', '/api/download', { url: `https://booth.pm/en/items/${100 + i}` }, headers);
    assert.equal(accepted.status, 202);
  }
  const tooMany = await request(port, 'POST', '/api/download', { url: 'https://booth.pm/en/items/500' }, headers);
  assert.equal(tooMany.status, 429);

  await instance.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
