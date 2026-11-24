'use strict';

// Serves the Tampermonkey companion script from a short-lived loopback server.
// A website cannot install a userscript without user confirmation, so the app
// opens the browser on the script URL and Tampermonkey shows its install page.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const COMPANION_PATH = path.join(__dirname, '..', 'companion', 'BBLM.user.js');
const USERSCRIPT_NAME = 'bblm-companion.user.js';

function hasValidHeader(script) {
  if (typeof script !== 'string') return false;
  if (!script.includes('// ==UserScript==')) return false;
  if (!script.includes('// ==/UserScript==')) return false;
  for (const tag of ['@name', '@version', '@match']) {
    if (!new RegExp(`^//\\s*${tag}\\s+\\S`, 'm').test(script)) return false;
  }
  return true;
}

function buildUserscript({ version } = {}) {
  let script = fs.readFileSync(COMPANION_PATH, 'utf8');
  if (!hasValidHeader(script)) {
    throw new Error('The companion script has no valid UserScript header.');
  }

  if (typeof version === 'string' && version.trim() !== '') {
    const candidate = version.trim();
    if (/^[0-9]+(\.[0-9]+){0,3}(-[0-9A-Za-z.-]+)?$/.test(candidate)) {
      script = script.replace(/^(\/\/\s*@version\s+).*$/m, `$1${candidate}`);
    }
  }

  return script;
}

function startUserscriptServer({
  script,
  host = '127.0.0.1',
  timeoutMs = 5 * 60 * 1000,
  closeAfterMs = 5000,
} = {}) {
  if (typeof script !== 'string' || script.trim() === '') {
    return Promise.reject(new Error('The companion script is empty.'));
  }

  return new Promise((resolve, reject) => {
    const token = crypto.randomBytes(16).toString('hex');
    const scriptPath = `/${token}.user.js`;
    let resolved = false;
    let closed = false;
    let idleTimer = null;
    let timeoutTimer = null;
    let resolveDone;
    const done = new Promise((doneResolve) => { resolveDone = doneResolve; });

    const server = http.createServer((req, res) => {
      let pathname = '';
      try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { pathname = ''; }

      if ((req.method !== 'GET' && req.method !== 'HEAD') || pathname !== scriptPath) {
        res.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'close',
        });
        return res.end('Not found');
      }

      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Content-Disposition': `inline; filename="${USERSCRIPT_NAME}"`,
        'Content-Length': Buffer.byteLength(script),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        Connection: 'close',
      });
      if (req.method === 'HEAD') {
        res.end();
        scheduleFinish();
        return;
      }
      res.end(script, scheduleFinish);
    });

    function finish(result) {
      if (closed) return;
      closed = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      server.close(() => resolveDone(result));
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    }

    function scheduleFinish() {
      if (closed || idleTimer) return;
      idleTimer = setTimeout(() => finish({ served: true }), closeAfterMs);
    }

    server.on('error', (error) => {
      if (resolved) return;
      resolved = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      reject(error);
    });

    server.listen(0, host, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolved = true;
      timeoutTimer = setTimeout(() => finish({ served: false }), timeoutMs);
      resolve({
        url: `http://${host}:${port}${scriptPath}`,
        done,
        close: () => finish({ served: false }),
      });
    });
  });
}

module.exports = { COMPANION_PATH, buildUserscript, startUserscriptServer };
