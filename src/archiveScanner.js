'use strict';

const fs = require('fs');
const path = require('path');
const { fork, spawnSync } = require('child_process');

const COMPRESSED_EXTS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.unitypackage', '.nupkg', '.jar', '.whl', '.egg']);

function find7zip() {
  for (const candidate of ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe', '7z']) {
    try { if (candidate === '7z' || fs.existsSync(candidate)) { const result = spawnSync(candidate, ['i'], { windowsHide: true, timeout: 3000 }); if (!result.error) return candidate; } } catch {}
  }
  return null;
}

function collectArchives(root, max = 10000) {
  const result = [];
  const walk = dir => {
    if (result.length >= max) throw new Error('Too many archives');
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (COMPRESSED_EXTS.has(path.extname(entry.name).toLowerCase())) result.push(full);
    }
  };
  walk(root); return result;
}

function scanArchives(folder, options = {}) {
  const sevenZip = options.sevenZip || find7zip();
  if (!sevenZip) return Promise.reject(new Error('7-Zip not found'));
  const archives = collectArchives(folder, options.maxArchives || 10000);
  const worker = fork(path.join(__dirname, 'scannerWorker.js'), [], { windowsHide: true });
  let settled = false;
  let resolveResult; let rejectResult;
  const promise = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const results = [];
  worker.on('message', message => {
    options.onProgress?.(message);
    if (message.type === 'archive' && message.found) results.push({ archive: message.archive, content: message.found });
    if (message.type === 'done' || message.type === 'cancelled') { settled = true; resolveResult({ ok: message.type === 'done', results, archives }); worker.kill(); }
  });
  worker.on('error', error => { if (!settled) { settled = true; rejectResult(error); } });
  worker.send({ type: 'scan', sevenZip, archives, limits: options.limits });
  const cancel = () => { if (!settled) worker.send({ type: 'cancel' }); };
  promise.cancel = cancel;
  return promise;
}

module.exports = { scanArchives, collectArchives, find7zip, COMPRESSED_EXTS };
