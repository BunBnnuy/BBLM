'use strict';

// This file is a forkable worker. It performs all 7-Zip and filesystem work
// outside Electron's main process.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const tar = require('tar');

const DEFAULTS = {
  maxEntries: 5000,
  maxEntryBytes: 512 * 1024 * 1024,
  maxArchiveBytes: 2 * 1024 * 1024 * 1024,
  pathnameBytes: 64 * 1024,
  maxMetadataBytes: 256 * 1024,
  maxMetadataFiles: 24,
  archiveTimeoutMs: 60_000,
  maxDepth: 4,
  maxNestedArchives: 100,
};
const UNITY_PACKAGE_EXT = '.unitypackage';
const NESTED_ARCHIVE_EXTS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.nupkg', '.jar', '.whl', '.egg']);
const METADATA_EXTS = new Set(['.txt', '.md', '.json', '.url', '.website', '.html', '.htm']);
let active;
let cancelled = false;

function invalidEntry(name) {
  return !name || path.isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name) || /^\\\\|^\\?\?\\/.test(name) || name.split(/[\\/]/).some(part => part === '..');
}
function send(message) { if (process.send) process.send(message); }
function removeTree(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function run7z(binary, args, timeoutMs, partialMode = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    active = child;
    let stdout = ''; let stderr = ''; let timer;
    const finish = (error, result) => { clearTimeout(timer); active = undefined; if (error) reject(error); else resolve(result); };
    timer = setTimeout(() => { child.kill(); finish(new Error('Archive operation timed out')); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 16 * 1024 * 1024) { child.kill(); finish(new Error('Archive listing is too large')); } });
    child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 1024); });
    child.on('error', finish);
    child.on('close', code => {
      const hasEntryListing = /^-{5,}$/m.test(stdout);
      if (code === 0 || partialMode === 'output' || (partialMode === 'listing' && hasEntryListing)) {
        finish(null, { stdout, stderr, code });
      } else {
        finish(new Error(stderr || `7-Zip exited with ${code}`));
      }
    });
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

function packageEntries(entries) {
  return entries.filter(entry => String(entry.Folder).trim() !== '+' && path.extname(entry.Path).toLowerCase() === UNITY_PACKAGE_EXT);
}

function nestedArchiveEntries(entries) {
  return entries.filter(entry => String(entry.Folder).trim() !== '+' && NESTED_ARCHIVE_EXTS.has(path.extname(entry.Path).toLowerCase()));
}

function isMetadataName(name) {
  const base = path.basename(String(name || '')).toLowerCase();
  return METADATA_EXTS.has(path.extname(base)) || /read.?me|license|terms|利用規約|説明/.test(base);
}

function metadataEntries(entries, limits) {
  return entries.filter(entry => {
    const size = Number(entry.Size || 0);
    return String(entry.Folder).trim() !== '+' && isMetadataName(entry.Path) && size >= 0 && size <= limits.maxMetadataBytes;
  }).slice(0, limits.maxMetadataFiles);
}

async function readUnityPackageMetadata(packagePath, limits = DEFAULTS) {
  const pathnames = new Map();
  const assets = new Map();
  const metadataTexts = [];
  let firstPathname;
  let pathnameError;
  const collectEntry = (entry, onComplete) => {
    const chunks = [];
    let size = 0;
    entry.on('data', chunk => {
      size += chunk.length;
      if (size <= limits.maxMetadataBytes) chunks.push(chunk);
    });
    entry.on('end', () => onComplete(size, Buffer.concat(chunks)));
  };
  const collectPairedMetadata = key => {
    const pathname = pathnames.get(key);
    const asset = assets.get(key);
    if (!pathname || !asset) return;
    if (isMetadataName(pathname)) {
      const text = asset.toString('utf8').replace(/\u0000/g, '').trim();
      if (text && metadataTexts.length < limits.maxMetadataFiles) metadataTexts.push(text.slice(0, limits.maxMetadataBytes));
    }
    assets.delete(key);
  };
  await tar.t({
    file: packagePath,
    onentry: entry => {
      const normalized = String(entry.path).replace(/\\/g, '/');
      const base = path.posix.basename(normalized).toLowerCase();
      const key = path.posix.dirname(normalized);
      if (base === 'pathname') {
        if (entry.size > limits.pathnameBytes) {
          pathnameError = new Error('pathname file is too large');
          entry.resume();
          return;
        }
        collectEntry(entry, (size, buffer) => {
          if (size > limits.pathnameBytes) pathnameError = new Error('pathname file is too large');
          else {
            const value = buffer.toString('utf8').trim();
            if (value) {
              if (!firstPathname) firstPathname = value;
              if (pathnames.size < limits.maxEntries) pathnames.set(key, value);
              collectPairedMetadata(key);
            }
          }
        });
        return;
      }
      if (base === 'asset' && entry.size <= limits.maxMetadataBytes && assets.size < limits.maxMetadataFiles * 4) {
        collectEntry(entry, (size, buffer) => {
          if (size <= limits.maxMetadataBytes) {
            assets.set(key, buffer);
            collectPairedMetadata(key);
          }
        });
        return;
      }
      entry.resume();
    },
  });
  if (pathnameError) throw pathnameError;
  for (const [key, pathname] of pathnames) {
    if (metadataTexts.length >= limits.maxMetadataFiles) break;
    if (!isMetadataName(pathname) || !assets.has(key)) continue;
    const text = assets.get(key).toString('utf8').replace(/\u0000/g, '').trim();
    if (text) metadataTexts.push(text.slice(0, limits.maxMetadataBytes));
  }
  return { pathname: firstPathname, metadataTexts };
}

async function readUnityPackagePathname(packagePath, limits = DEFAULTS) {
  return (await readUnityPackageMetadata(packagePath, limits)).pathname;
}

function collectExtractedCandidates(extractedRoot) {
  const packages = [];
  const nested = [];
  const metadata = [];
  const realRoot = fs.realpathSync(extractedRoot);
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const candidate = path.join(dir, entry.name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink() || entry.isBlockDevice?.() || entry.isCharacterDevice?.()) throw new Error('Archive contains a link or device');
      if (stat.isDirectory()) {
        walk(candidate);
        continue;
      }
      if (!stat.isFile()) continue;
      const realPath = fs.realpathSync(candidate);
      if (!inside(realRoot, realPath)) throw new Error('Archive entry escaped the extraction folder');
      const extension = path.extname(entry.name).toLowerCase();
      if (extension === UNITY_PACKAGE_EXT) packages.push(realPath);
      else if (NESTED_ARCHIVE_EXTS.has(extension)) nested.push(realPath);
      else if (isMetadataName(entry.name)) metadata.push(realPath);
    }
  };
  walk(extractedRoot);
  return { packages, nested, metadata };
}

async function findUnityPackages(binary, archive, limits, tempRoot, depth, state) {
  if (cancelled) return { pathnames: [], metadataTexts: [] };
  // 7-Zip can return a non-zero code for a damaged non-package entry while
  // still giving a usable, bounded file listing. Use that listing so intact
  // Unity packages in the same archive remain discoverable.
  const listing = await run7z(binary, ['l', '-slt', '--', archive], limits.archiveTimeoutMs, 'listing');
  const entries = parseListing(listing.stdout, limits);
  const packages = packageEntries(entries);
  const nested = nestedArchiveEntries(entries);
  const metadata = metadataEntries(entries, limits);
  if (packages.length === 0 && (nested.length === 0 || depth >= limits.maxDepth)) return { pathnames: [], metadataTexts: [] };

  const listedNested = depth < limits.maxDepth ? nested : [];

  const extractedRoot = path.join(tempRoot, `${depth}-${crypto.randomUUID()}`);
  fs.mkdirSync(extractedRoot, { recursive: true, mode: 0o700 });
  // Extract only packages and nested archives. This avoids expanding unrelated
  // model and texture files while the validated listing still blocks traversal.
  const selectedPaths = [...packages, ...listedNested, ...metadata].map(entry => entry.Path);
  const includeSwitches = selectedPaths.map(selectedPath => `-i!${selectedPath}`);
  await run7z(binary, ['x', `-o${extractedRoot}`, '-y', ...includeSwitches, '--', archive], limits.archiveTimeoutMs, 'output');

  let extracted = collectExtractedCandidates(extractedRoot);
  if (extracted.packages.length < packages.length || extracted.nested.length < listedNested.length || extracted.metadata.length < metadata.length) {
    // Some 7-Zip builds return member names through a legacy Windows code page.
    // A Unicode member can then be listed with a different name than the one
    // written to disk. Fall back to the already bounded full extraction.
    await run7z(binary, ['x', `-o${extractedRoot}`, '-y', '--', archive], limits.archiveTimeoutMs, 'output');
    extracted = collectExtractedCandidates(extractedRoot);
  }

  const nestedToScan = depth < limits.maxDepth ? extracted.nested : [];
  state.nestedArchives += nestedToScan.length;
  if (state.nestedArchives > limits.maxNestedArchives) throw new Error('Archive has too many nested archives');

  const found = { pathnames: [], metadataTexts: [] };
  for (const packagePath of extracted.packages) {
    if (cancelled) break;
    const packageMetadata = await readUnityPackageMetadata(packagePath, limits);
    if (packageMetadata.pathname && !found.pathnames.includes(packageMetadata.pathname)) found.pathnames.push(packageMetadata.pathname);
    found.metadataTexts.push(...packageMetadata.metadataTexts);
  }
  for (const metadataPath of extracted.metadata.slice(0, limits.maxMetadataFiles - found.metadataTexts.length)) {
    const stat = fs.statSync(metadataPath);
    if (stat.size > limits.maxMetadataBytes) continue;
    const text = fs.readFileSync(metadataPath, 'utf8').replace(/\u0000/g, '').trim();
    if (text) found.metadataTexts.push(text.slice(0, limits.maxMetadataBytes));
  }

  for (const nestedPath of nestedToScan) {
    if (cancelled) break;
    const nestedFound = await findUnityPackages(
      binary,
      nestedPath,
      limits,
      tempRoot,
      depth + 1,
      state
    );
    found.pathnames.push(...nestedFound.pathnames);
    found.metadataTexts.push(...nestedFound.metadataTexts.slice(0, limits.maxMetadataFiles - found.metadataTexts.length));
  }
  return found;
}

async function processArchive(binary, archive, limits = DEFAULTS) {
  if (path.extname(archive).toLowerCase() === UNITY_PACKAGE_EXT) {
    const packageMetadata = await readUnityPackageMetadata(archive, limits);
    return { found: packageMetadata.pathname, pathnames: packageMetadata.pathname ? [packageMetadata.pathname] : [], metadataTexts: packageMetadata.metadataTexts, entries: 1 };
  }
  const tempRoot = path.join(os.tmpdir(), `bblm-scan-${crypto.randomUUID()}`);
  fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 });
  try {
    const discovered = await findUnityPackages(binary, archive, limits, tempRoot, 0, { nestedArchives: 0 });
    const pathnames = [...new Set(discovered.pathnames)];
    return { found: pathnames.length ? pathnames.join(' | ') : undefined, pathnames, metadataTexts: discovered.metadataTexts };
  } finally { removeTree(tempRoot); }
}

async function main(message) {
  cancelled = false;
  const limits = { ...DEFAULTS, ...(message.limits || {}) };
  let found = 0;
  for (let i = 0; i < message.archives.length; i++) {
    if (cancelled) break;
    const archive = message.archives[i];
    try {
      const result = await processArchive(message.sevenZip, archive, limits);
      if (result.found) found++;
      send({ type: 'archive', archive, index: i + 1, total: message.archives.length, ...result });
    } catch (error) { send({ type: 'archive_error', archive, index: i + 1, message: error.message }); }
  }
  send({ type: cancelled ? 'cancelled' : 'done', total: message.archives.length, found });
}
if (require.main === module && process.send) process.on('message', message => { if (message.type === 'cancel') { cancelled = true; if (active) active.kill(); } else if (message.type === 'scan') main(message); });
module.exports = { invalidEntry, parseListing, packageEntries, nestedArchiveEntries, readUnityPackageMetadata, readUnityPackagePathname, processArchive, DEFAULTS };
