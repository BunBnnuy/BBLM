'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { buildUserscript, startUserscriptServer } = require('../src/userscript');

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}

test('companion script has a valid userscript header', () => {
  const script = buildUserscript({ version: '9.9.9' });
  assert.match(script, /^\/\/ ==UserScript==$/m);
  assert.match(script, /^\/\/ ==\/UserScript==$/m);
  assert.match(script, /^\/\/ @name\s+\S/m);
  assert.match(script, /^\/\/ @version\s+9\.9\.9$/m);
  assert.match(script, /^\/\/ @match\s+https:\/\/booth\.pm\/\*$/m);
  assert.match(script, /client=booth-library-manager/);
});

test('build ignores a version that is not a simple version number', () => {
  const script = buildUserscript({ version: '1.0.0\n// @match https://evil.test/*' });
  assert.match(script, /^\/\/ @version\s+1\.0\.0$/m);
  assert.doesNotMatch(script, /evil\.test/);
});

test('server serves the script from the token path and closes', async (t) => {
  const script = buildUserscript({ version: '1.2.3' });
  const session = await startUserscriptServer({ script, closeAfterMs: 50 });
  t.after(() => session.close());

  const url = new URL(session.url);
  const response = await get(url.port, url.pathname);
  assert.equal(response.status, 200);
  assert.equal(response.body, script);
  assert.match(response.headers['content-type'], /javascript/);
  assert.match(response.headers['content-disposition'], /inline/);
  assert.equal(response.headers['cache-control'], 'no-store');

  const result = await session.done;
  assert.equal(result.served, true);
});

test('server rejects other paths', async (t) => {
  const session = await startUserscriptServer({ script: buildUserscript({ version: '1.2.3' }), timeoutMs: 5000 });
  t.after(() => session.close());

  const url = new URL(session.url);
  const response = await get(url.port, '/not-the-script.user.js');
  assert.equal(response.status, 404);
});

test('server closes when the browser never opens the script', async () => {
  const session = await startUserscriptServer({ script: buildUserscript({ version: '1.2.3' }), timeoutMs: 50 });
  const result = await session.done;
  assert.equal(result.served, false);
});

test('server rejects an empty script', async () => {
  await assert.rejects(() => startUserscriptServer({ script: '  ' }), /empty/);
});
