'use strict';

// This file is a forkable worker. It performs all 7-Zip and filesystem work
// outside Electron's main process.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DEFAULTS = { maxEntries: 5000, maxEntryBytes: 512 * 1024 * 1024, maxArchiveBytes: 2 * 1024 * 1024 * 1024, pathnameBytes: 64 * 1024, archiveTimeoutMs: 60_000 };
let active;
let cancelled = false;

function invalidEntry(name) {
  return !name || path.isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name) || /^\\\\|^\\?\?\\/.test(name) || name.split(/[\\/]/).some(part => part === '..');
}
function send(message) { if (process.send) process.send(message); }
function removeTree(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

function run7z(binary, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    active = child;
    let stdout = ''; let stderr = ''; let timer;
    const finish = (error, result) => { clearTimeout(timer); active = undefined; if (error) reject(error); else resolve(result); };
    timer = setTimeout(() => { child.kill(); finish(new Error('Archive operation timed out')); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 16 * 1024 * 1024) { child.kill(); finish(new Error('Archive listing is too large')); } });
    child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 1024); });
    child.on('error', finish);
    child.on('close', code => code === 0 ? finish(null, { stdout, stderr }) : finish(new Error(stderr || `7-Zip exited with ${code}`)));
  });
}

function parseListing(text, limits) {
  const entries = []; let current = {};
  // `7z l -slt` prints one archive-level block first (Path = <the archive
  // itself>, an absolute path that would otherwise trip invalidEntry below),
  // then a line of dashes, then one blank-line-separated block per file.
  // Skip everything up to and including that separator.
  const sepIndex = text.split(/\r?\n/).findIndex(l => /^-{5,}$/.test(l.trim()));
  const lines = sepIndex === -1 ? text.split(/\r?\n/) : text.split(/\r?\n/).slice(sepIndex + 1);
  for (const line of lines) {
    if (!line.trim()) { if (current.Path) entries.push(current); current = {}; continue; }
    const index = line.indexOf(' = '); if (index < 0) continue;
    current[line.slice(0, index)] = line.slice(index + 3);
    if (entries.length + 1 > limits.maxEntries) throw new Error('Archive has too many entries');
  }
  if (current.Path) entries.push(current);
  let total = 0;
  for (const entry of entries) {
    if (invalidEntry(entry.Path)) throw new Error('Archive contains an unsafe path');
    if (String(entry.Encrypted).toLowerCase() === '+' || String(entry.Method).toLowerCase().includes('encrypted')) throw new Error('Encrypted archives are not supported');
    const size = Number(entry.Size || 0); if (!Number.isFinite(size) || size < 0 || size > limits.maxEntryBytes) throw new Error('Archive entry exceeds size limit');
    total += size; if (total > limits.maxArchiveBytes) throw new Error('Archive exceeds expanded size limit');
  }
  return entries;
}

async function processArchive(binary, archive, limits) {
  const listing = await run7z(binary, ['l', '-slt', '--', archive], limits.archiveTimeoutMs);
  const entries = parseListing(listing.stdout, limits);
  const temp = path.join(os.tmpdir(), `bblm-scan-${crypto.randomUUID()}`);
  fs.mkdirSync(temp, { recursive: true, mode: 0o700 });
  try {
    // Switches must precede `--`; 7-Zip treats anything after `--` as a literal
    // filename/archive argument, not a switch, so `-o`/`-y` placed after it are
    // silently ignored and nothing gets extracted ("No files to process").
    await run7z(binary, ['x', `-o${temp}`, '-y', '--', archive], limits.archiveTimeoutMs);
    let found;
    const walk = dir => {
      if (cancelled || found) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (cancelled || found) return;
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink() || entry.isBlockDevice?.() || entry.isCharacterDevice?.()) throw new Error('Archive contains a link or device');
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'pathname') {
          const stat = fs.statSync(full); if (stat.size > limits.pathnameBytes) throw new Error('pathname file is too large');
          const content = fs.readFileSync(full, 'utf8').trim(); if (content) found = content;
        }
      }
    };
    walk(temp);
    return { found, entries: entries.length };
  } finally { removeTree(temp); }
}

async function main(message) {
  cancelled = false;
  const limits = { ...DEFAULTS, ...(message.limits || {}) };
  for (let i = 0; i < message.archives.length; i++) {
    if (cancelled) break;
    const archive = message.archives[i];
    try {
      const result = await processArchive(message.sevenZip, archive, limits);
      send({ type: 'archive', archive, index: i + 1, total: message.archives.length, ...result });
    } catch (error) { send({ type: 'archive_error', archive, index: i + 1, message: error.message }); }
  }
  send({ type: cancelled ? 'cancelled' : 'done' });
}
if (require.main === module && process.send) process.on('message', message => { if (message.type === 'cancel') { cancelled = true; if (active) active.kill(); } else if (message.type === 'scan') main(message); });
module.exports = { invalidEntry, parseListing, DEFAULTS };
