const fs = require('fs');
const path = require('path');
const { resolveExistingAssetDir } = require('./security/pathPolicy');
const { writeJsonAtomic } = require('./atomicFs');

const INDEX_FILE = '.blm-index.json';

/** Full, authoritative scan of rootFolder — same cost/shape as the pre-index getAssets(). */
function scanDiskEntries(rootFolder) {
  const entries = {};
  for (const entry of fs.readdirSync(rootFolder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let assetDir; try { assetDir = resolveExistingAssetDir(rootFolder, entry.name); } catch { continue; }
    const metaPath = path.join(assetDir, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      entries[entry.name] = meta;
    } catch {
      // skip malformed entries
    }
  }
  return entries;
}

function readIndexFile(rootFolder) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(rootFolder, INDEX_FILE), 'utf8'));
    if (!raw || typeof raw.entries !== 'object' || raw.entries === null) return null;
    return raw.entries;
  } catch {
    return null;
  }
}

function writeIndexFile(rootFolder, entriesObj) {
  writeJsonAtomic(path.join(rootFolder, INDEX_FILE), {
    version: 1,
    generatedAt: new Date().toISOString(),
    entries: entriesObj,
  });
}

/** Cheap path join for a trusted (already-validated) index entry — no per-call disk I/O. */
function fastThumbnailPath(rootFolder, assetId, thumbnail) {
  return path.join(rootFolder, assetId, thumbnail);
}

module.exports = { INDEX_FILE, scanDiskEntries, readIndexFile, writeIndexFile, fastThumbnailPath };
