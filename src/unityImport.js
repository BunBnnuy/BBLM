'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { find7zip } = require('./archiveScanner');
const { invalidEntry, parseListing, DEFAULTS } = require('./scannerWorker');

const UNITY_PACKAGE_EXT = '.unitypackage';
const NESTED_ARCHIVE_EXTS = new Set(['.zip', '.rar', '.7z']);
// Unity assets can contain very large textures and motion-capture files.
// Keep the archive operation bounded, but allow normal large asset packs.
const UNITY_IMPORT_LIMITS = {
  ...DEFAULTS,
  maxEntryBytes: 8 * 1024 * 1024 * 1024,
  maxArchiveBytes: 32 * 1024 * 1024 * 1024,
};

function run7z(binary, args, timeoutMs = DEFAULTS.archiveTimeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timer = setTimeout(() => {
      child.kill();
      reject(new Error('Archive operation timed out'));
    }, timeoutMs);
    const finish = (error, result) => {
      clearTimeout(timer);
      timer = null;
      if (error) reject(error); else resolve(result);
    };
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 4096); });
    child.on('error', finish);
    child.on('close', code => code === 0 ? finish(null, { stdout, stderr }) : finish(new Error(stderr || `7-Zip exited with ${code}`)));
  });
}

function isHiddenUnityFile(name) {
  const base = path.basename(name).toLowerCase();
  return base === 'meta.json' || base === 'thumbnail.png' || base === 'thumbnail.jpg' ||
    base === 'thumbnail.jpeg' || base === 'thumbnail.webp' || base.endsWith('.meta');
}

function safeRelativeEntry(name) {
  if (typeof name !== 'string' || invalidEntry(name)) throw new Error('Archive contains an unsafe path');
  const normalized = name.replace(/\\/g, '/');
  if (!normalized || normalized.endsWith('/') || isHiddenUnityFile(normalized)) return null;
  return normalized;
}

function entryKey(archiveIndex, chain) {
  return `${archiveIndex}:${JSON.stringify(chain)}`;
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function listArchive(binary, archivePath, archiveIndex, rootName, prefix, tempRoot, depth, output) {
  if (depth > 4) throw new Error('Archive nesting is too deep');
  const listing = await run7z(binary, ['l', '-slt', '--', archivePath]);
  const entries = parseListing(listing.stdout, { ...UNITY_IMPORT_LIMITS, maxEntries: 5000 });
  let extractedRoot = null;
  for (const entry of entries) {
    const relativePath = safeRelativeEntry(entry.Path);
    if (!relativePath) continue;
    const chain = [...prefix, relativePath];
    const ext = path.extname(relativePath).toLowerCase();
    if (NESTED_ARCHIVE_EXTS.has(ext)) {
      if (!extractedRoot) {
        extractedRoot = path.join(tempRoot, `${archiveIndex}-${depth}-${output.length}`);
        fs.mkdirSync(extractedRoot, { recursive: true });
        await run7z(binary, ['x', `-o${extractedRoot}`, '-y', '--', archivePath]);
      }
      const nestedPath = path.resolve(extractedRoot, relativePath);
      if (!inside(extractedRoot, nestedPath) || !fs.existsSync(nestedPath) || !fs.statSync(nestedPath).isFile()) throw new Error('Nested archive could not be extracted safely');
      await listArchive(binary, nestedPath, archiveIndex, rootName, chain, tempRoot, depth + 1, output);
      continue;
    }
    output.push({
      key: entryKey(archiveIndex, chain),
      archiveIndex,
      archive: rootName,
      path: chain.join(' / '),
      chain,
      size: Number(entry.Size || 0),
      unityPackage: ext === UNITY_PACKAGE_EXT,
    });
  }
}

async function listUnityImportEntries(archives, options = {}) {
  const sevenZip = options.sevenZip || find7zip();
  if (!sevenZip) throw new Error('7-Zip not found');
  const output = [];
  const tempRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bblm-unity-list-'));
  try {
    for (let archiveIndex = 0; archiveIndex < archives.length; archiveIndex++) {
      const archive = archives[archiveIndex];
      if (path.extname(archive).toLowerCase() === UNITY_PACKAGE_EXT) {
        output.push({ key: entryKey(archiveIndex, []), archiveIndex, archive: path.basename(archive), path: path.basename(archive), chain: [], size: fs.statSync(archive).size, unityPackage: true });
      } else {
        await listArchive(sevenZip, archive, archiveIndex, path.basename(archive), [], tempRoot, 0, output);
      }
    }
    return output;
  } finally { try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {} }
}

async function extractSelectedUnityFiles(archives, selectedEntries, destination, options = {}) {
  const sevenZip = options.sevenZip || find7zip();
  if (!sevenZip) throw new Error('7-Zip not found');
  fs.mkdirSync(destination, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bblm-unity-import-'));
  try {
    for (let selectedIndex = 0; selectedIndex < (selectedEntries || []).length; selectedIndex++) {
      const item = selectedEntries[selectedIndex];
      if (!Number.isInteger(item.archiveIndex) || !Array.isArray(item.chain)) throw new Error('Invalid Unity import selection');
      const archive = archives[item.archiveIndex];
      if (!archive) throw new Error('Invalid Unity import archive');
      const chain = item.chain.map(safeRelativeEntry);
      if (chain.some(value => !value)) throw new Error('Invalid Unity import selection');
      let currentArchive = archive;
      let currentRoot = null;
      for (let depth = 0; depth < chain.length; depth++) {
        currentRoot = path.join(tempRoot, `${selectedIndex}-${depth}`);
        fs.mkdirSync(currentRoot, { recursive: true });
        await run7z(sevenZip, ['x', `-o${currentRoot}`, '-y', '--', currentArchive]);
        const source = path.resolve(currentRoot, chain[depth]);
        if (!inside(currentRoot, source) || !fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('Archive entry could not be extracted safely');
        if (depth === chain.length - 1) {
          const isUnityPackage = path.extname(chain[depth]).toLowerCase() === UNITY_PACKAGE_EXT;
          const outputRoot = isUnityPackage ? (options.unityPackageDestination || destination) : destination;
          const outputPath = isUnityPackage ? path.join(outputRoot, path.basename(chain[depth])) : path.join(outputRoot, chain[depth]);
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          fs.copyFileSync(source, outputPath);
        } else {
          currentArchive = source;
        }
      }
      if (chain.length === 0) {
        const outputRoot = options.unityPackageDestination || destination;
        fs.mkdirSync(outputRoot, { recursive: true });
        fs.copyFileSync(archive, path.join(outputRoot, path.basename(archive)));
      }
    }
  } finally { try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {} }
}

module.exports = { isHiddenUnityFile, safeRelativeEntry, listUnityImportEntries, extractSelectedUnityFiles };
