const fs = require('fs');
const path = require('path');
const { resolveExistingAssetDir } = require('./security/pathPolicy');
const { writeJsonAtomic } = require('./atomicFs');

const INDEX_FILE = '.blm-index.json';

// Malware scanner logs are megabytes for a big library, and the index is
// rewritten on every save. Keep them out of the index and out of the in-memory
// list; the scan report reads them from meta.json only when it needs them.
function indexMeta(meta) {
  if (!meta || typeof meta !== 'object' || !Object.prototype.hasOwnProperty.call(meta, 'scanOutput')) return meta;
  const rest = { ...meta };
  delete rest.scanOutput;
  return rest;
}

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
      entries[entry.name] = indexMeta(meta);
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
    let bulky = false;
    const entries = {};
    for (const [id, meta] of Object.entries(raw.entries)) {
      if (meta && Object.prototype.hasOwnProperty.call(meta, 'scanOutput')) bulky = true;
      entries[id] = indexMeta(meta);
    }
    // Older index files kept the scanner logs. Replace one once, in the
    // background of this read, so later startups stay fast.
    if (bulky) { try { writeIndexFile(rootFolder, entries); } catch { /* rewrite on the next save */ } }
    return entries;
  } catch {
    return null;
  }
}

function writeIndexFile(rootFolder, entriesObj) {
  const entries = {};
  for (const [id, meta] of Object.entries(entriesObj)) entries[id] = indexMeta(meta);
  writeJsonAtomic(path.join(rootFolder, INDEX_FILE), {
    version: 1,
    generatedAt: new Date().toISOString(),
    entries,
  });
}

/** Cheap path join for a trusted (already-validated) index entry — no per-call disk I/O. */
function fastThumbnailPath(rootFolder, assetId, thumbnail) {
  return path.join(rootFolder, assetId, thumbnail);
}

module.exports = { INDEX_FILE, indexMeta, scanDiskEntries, readIndexFile, writeIndexFile, fastThumbnailPath };
