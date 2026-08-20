'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function randomSuffix() {
  return `${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

/** Atomically replace a JSON file. The temporary file is created exclusively. */
function writeJsonAtomic(filePath, value, options = {}) {
  const mode = options.mode || 0o600;
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = `${filePath}.${randomSuffix()}.tmp`;
  const data = `${JSON.stringify(value, null, 2)}\n`;
  let fd;
  try {
    fd = fs.openSync(tempPath, 'wx', mode);
    fs.writeFileSync(fd, data, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, filePath);
    try { fsyncDirectory(directory); } catch { /* Windows may reject directory fsync. */ }
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }
}

function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function createStagingDirectory(root, id = randomSuffix()) {
  const stagingRoot = path.join(root, '.bblm-staging');
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const dir = path.join(stagingRoot, id);
  fs.mkdirSync(dir, { mode: 0o700 });
  return dir;
}

function removeTree(target) {
  if (!target) return;
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 20 });
}

function cleanupStaging(root, maxAgeMs = 24 * 60 * 60 * 1000) {
  const stagingRoot = path.join(root, '.bblm-staging');
  let entries;
  try { entries = fs.readdirSync(stagingRoot, { withFileTypes: true }); } catch { return 0; }
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.includes('..') || /[\\/]/.test(entry.name)) continue;
    const target = path.join(stagingRoot, entry.name);
    try {
      if (fs.statSync(target).mtimeMs < cutoff) { removeTree(target); removed++; }
    } catch { /* A concurrent transaction may have removed it. */ }
  }
  return removed;
}

module.exports = { writeJsonAtomic, createStagingDirectory, cleanupStaging, removeTree };
