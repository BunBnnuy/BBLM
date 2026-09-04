const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { download } = require('./httpClient');
const { resolveInsideRoot, resolveExistingAssetDir, allocateAssetId, sanitizeExternalFilename } = require('./security/pathPolicy');
const { writeJsonAtomic } = require('./atomicFs');
const { scanDiskEntries, readIndexFile, writeIndexFile, fastThumbnailPath } = require('./assetIndex');

// In-memory cache of the current rootFolder's asset index, populated on first
// getAssets() call and kept in sync via touchIndexEntry/removeIndexEntry.
let cache = null; // { rootFolder, entries: Map<assetId, meta> }

function materialize(rootFolder, entriesMap) {
  const assets = [];
  for (const [assetId, meta] of entriesMap) {
    const out = { ...meta };
    if (out.thumbnail) out.thumbnailPath = fastThumbnailPath(rootFolder, assetId, out.thumbnail);
    assets.push(out);
  }
  return assets.sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
}

function touchIndexEntry(store, assetId, meta) {
  const rootFolder = store.get('rootFolder', '');
  if (!cache || cache.rootFolder !== rootFolder) return;
  cache.entries.set(assetId, meta);
  try { writeIndexFile(rootFolder, Object.fromEntries(cache.entries)); } catch (e) { console.error('[assetIndex] write failed:', e.message); }
}

function removeIndexEntry(store, assetId) {
  const rootFolder = store.get('rootFolder', '');
  if (!cache || cache.rootFolder !== rootFolder) return;
  cache.entries.delete(assetId);
  try { writeIndexFile(rootFolder, Object.fromEntries(cache.entries)); } catch (e) { console.error('[assetIndex] write failed:', e.message); }
}

function discardIncompleteDownload({ assetId, store }) {
  const rootFolder = store.get('rootFolder', '');
  let assetDir;
  try { assetDir = resolveExistingAssetDir(rootFolder, assetId); } catch { return false; }

  const metaPath = path.join(assetDir, 'meta.json');
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return false; }

  // Only remove a shell created by createAssetShell(). Never remove a card
  // that has a completed file or an unrecognized user file in its folder.
  if (meta.downloadStatus !== 'pending' || (meta.files || []).length > 0) return false;
  const shellFiles = new Set(['meta.json', 'thumbnail.png', 'thumbnail_raw.tmp']);
  const contents = fs.readdirSync(assetDir, { withFileTypes: true });
  if (contents.some(entry => !entry.isFile() || !shellFiles.has(entry.name))) return false;

  fs.rmSync(assetDir, { recursive: true, force: true });
  const hadCache = cache && cache.rootFolder === rootFolder;
  removeIndexEntry(store, assetId);
  if (!hadCache) reconcileIndex(store);
  return true;
}

function cleanupIncompleteDownloads(store) {
  const rootFolder = store.get('rootFolder', '');
  if (!rootFolder || !fs.existsSync(rootFolder)) return 0;

  let removed = 0;
  for (const entry of fs.readdirSync(rootFolder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (discardIncompleteDownload({ assetId: entry.name, store })) removed++;
  }
  return removed;
}

function reconcileIndex(store) {
  const rootFolder = store.get('rootFolder', '');
  if (!rootFolder || !fs.existsSync(rootFolder)) return null;

  const disk = scanDiskEntries(rootFolder);
  const before = cache && cache.rootFolder === rootFolder
    ? cache.entries
    : new Map(Object.entries(readIndexFile(rootFolder) || {}));

  let added = 0, removed = 0, changed = 0;
  const diskIds = new Set(Object.keys(disk));
  for (const id of diskIds) {
    if (!before.has(id)) added++;
    else if (JSON.stringify(before.get(id)) !== JSON.stringify(disk[id])) changed++;
  }
  for (const id of before.keys()) {
    if (!diskIds.has(id)) removed++;
  }

  if (added === 0 && removed === 0 && changed === 0) return null;

  const entries = new Map(Object.entries(disk));
  cache = { rootFolder, entries };
  try { writeIndexFile(rootFolder, disk); } catch (e) { console.error('[assetIndex] write failed:', e.message); }
  return { added, removed, changed };
}

function extractAssetId(originUrl) {
  try {
    const url = new URL(originUrl);
    const host = url.hostname.toLowerCase(); // e.g. storename.gumroad.com

    // ── Gumroad: <storename>.gumroad.com/i/<asset-slug> ──
    if (host.endsWith('.gumroad.com')) {
      const storeName = host.replace(/\.gumroad\.com$/, '');
      const parts = url.pathname.split('/').filter(Boolean);
      const assetSlug = parts[parts.length - 1] || 'unknown';
      const id = `${storeName}.${assetSlug}`
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .toLowerCase()
        .slice(0, 120);
      return id;
    }

    // ── Jinxxy: jinxxy.com/<storename>/<asset> ──
    if (host === 'jinxxy.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        const storeName = parts[0];
        const assetSlug = parts[1];
        return `${storeName}.${assetSlug}`
          .replace(/[^a-zA-Z0-9._-]/g, '-')
          .toLowerCase()
          .slice(0, 120);
      }
    }

    // ── Default: last non-empty path segment ──
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      const raw = parts[parts.length - 1];
      return raw.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase().slice(0, 80);
    }
    return url.hostname.replace(/\./g, '-') + '-' + Date.now();
  } catch {
    return 'asset-' + Date.now();
  }
}

function extractBoothItemId(originUrl) {
  try {
    const url = new URL(originUrl);
    const host = url.hostname.toLowerCase();
    if (host !== 'booth.pm' && !host.endsWith('.booth.pm')) return null;
    const match = url.pathname.match(/\/items\/(\d+)(?:\/|$)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function findExistingBoothAsset({ originUrl, itemId, store }) {
  const boothItemId = String(itemId || extractBoothItemId(originUrl) || '');
  if (!boothItemId) return null;

  const candidates = getAssets(store).filter(asset =>
    extractBoothItemId(asset.originUrl) === boothItemId
  );
  candidates.sort((a, b) => {
    const aComplete = a.downloadStatus !== 'pending' && (a.files || []).length > 0 ? 1 : 0;
    const bComplete = b.downloadStatus !== 'pending' && (b.files || []).length > 0 ? 1 : 0;
    if (aComplete !== bComplete) return bComplete - aComplete;
    const aExact = a.id === boothItemId ? 1 : 0;
    const bExact = b.id === boothItemId ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return (b.files || []).length - (a.files || []).length;
  });
  return candidates[0] || null;
}

function normalizeUrl(url) {
  // Fix protocol-relative URLs (//cdn.example.com/...) which break on Windows
  if (url.startsWith('//')) return 'https:' + url;
  return url;
}

function refererForUrl(url) {
  try {
    const { hostname } = new URL(url);
    if (hostname.endsWith('pximg.net')) return 'https://booth.pm/';
    if (hostname.endsWith('booth.pm'))  return 'https://booth.pm/';
  } catch {}
  return null;
}

function downloadFile(url, destPath, extraHeaders = {}) {
  url = normalizeUrl(url);
  const referer = refererForUrl(url);
  return download(url, destPath, { headers: { 'User-Agent': 'Mozilla/5.0', ...(referer ? { Referer: referer } : {}), ...extraHeaders }, maxBytes: 20 * 1024 * 1024 });
}

function registerTags(tags, store) {
  if (!tags || !tags.length) return;
  const existing = new Set(store.get('allTags', []));
  tags.forEach(t => existing.add(t));
  store.set('allTags', [...existing].sort((a, b) => a.localeCompare(b)));
}

async function importAsset({ originUrl, filePath, selectedImageUrl, assetName, tags, isAdult, store }) {
  const rootFolder = store.get('rootFolder', '');
  if (!rootFolder) throw new Error('Root folder not configured.');
  if (!fs.existsSync(rootFolder)) throw new Error('Root folder does not exist: ' + rootFolder);

  const assetId = allocateAssetId(rootFolder, extractAssetId(originUrl));
  const assetDir = resolveInsideRoot(rootFolder, assetId);

  if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });

  // Copy first. Remove the source only after thumbnail and metadata commit.
  const destFile = path.join(assetDir, sanitizeExternalFilename(path.basename(filePath)));
  const sameFile = path.resolve(filePath) === path.resolve(destFile);
  let copied = false;
  if (!sameFile) { fs.copyFileSync(filePath, destFile, fs.constants.COPYFILE_EXCL); copied = true; }

  // Download and transcode thumbnail to 500×500 PNG
  let thumbnailPath = null;
  if (selectedImageUrl) {
    const rawPath = path.join(assetDir, 'thumbnail_raw.tmp');
    thumbnailPath = path.join(assetDir, 'thumbnail.png');
    try {
      await downloadFile(selectedImageUrl, rawPath);
      await sharp(rawPath)
        .resize(500, 500, { fit: 'cover', position: 'centre' })
        .png()
        .toFile(thumbnailPath);
      fs.unlinkSync(rawPath);
    } catch (e) {
      console.error('Thumbnail processing failed:', e.message);
      try { fs.unlinkSync(rawPath); } catch {}
      if (copied) { try { fs.unlinkSync(destFile); } catch {} }
      thumbnailPath = null;
      // Don't swallow — surface to the modal so the user can see it
      throw new Error('Thumbnail download failed: ' + e.message);
    }
  }

  // Register tags globally
  if (tags && tags.length) registerTags(tags, store);

  // Write metadata
  const meta = {
    id: assetId,
    name: assetName || assetId,
    originUrl,
    files: [path.basename(destFile)],
    thumbnail: thumbnailPath ? 'thumbnail.png' : null,
    importedAt: new Date().toISOString(),
    tags: tags || [],
    isAdult: !!isAdult,
  };
  try {
    writeJsonAtomic(path.join(assetDir, 'meta.json'), meta);
    if (copied) fs.unlinkSync(filePath);
  } catch (error) {
    if (copied) { try { fs.unlinkSync(destFile); } catch {} }
    throw error;
  }
  touchIndexEntry(store, assetId, meta);

  return { assetId, assetDir, meta };
}

function getAssets(store) {
  const rootFolder = store.get('rootFolder', '');
  if (!rootFolder || !fs.existsSync(rootFolder)) return [];

  // Fast path: already cached for this rootFolder this session.
  if (cache && cache.rootFolder === rootFolder) return materialize(rootFolder, cache.entries);

  // Try the on-disk index before falling back to a full scan.
  const indexEntries = readIndexFile(rootFolder);
  if (indexEntries) {
    cache = { rootFolder, entries: new Map(Object.entries(indexEntries)) };
    return materialize(rootFolder, cache.entries);
  }

  // No usable index yet — full scan, same as before this feature existed.
  const disk = scanDiskEntries(rootFolder);
  cache = { rootFolder, entries: new Map(Object.entries(disk)) };
  try { writeIndexFile(rootFolder, disk); } catch (e) { console.error('[assetIndex] write failed:', e.message); }
  return materialize(rootFolder, cache.entries);
}

async function updateAsset({ assetId, name, originUrl, selectedImageUrl, tags, isAdult, store }) {
  const rootFolder = store.get('rootFolder', '');
  const assetDir = resolveExistingAssetDir(rootFolder, assetId);
  const metaPath = path.join(assetDir, 'meta.json');
  if (!fs.existsSync(metaPath)) throw new Error('Asset not found: ' + assetId);

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (name) meta.name = name;
  if (originUrl !== undefined) meta.originUrl = originUrl;
  if (tags !== undefined) {
    meta.tags = tags;
    registerTags(tags, store);
  }
  if (isAdult !== undefined) meta.isAdult = !!isAdult;

  if (selectedImageUrl) {
    const rawPath = path.join(assetDir, 'thumbnail_raw.tmp');
    const thumbnailPath = path.join(assetDir, 'thumbnail.png');
    try {
      await downloadFile(selectedImageUrl, rawPath);
      await sharp(rawPath)
        .resize(500, 500, { fit: 'cover', position: 'centre' })
        .png()
        .toFile(thumbnailPath);
      fs.unlinkSync(rawPath);
      meta.thumbnail = 'thumbnail.png';
    } catch (e) {
      console.warn('Thumbnail update failed:', e.message);
      fs.unlink(rawPath, () => {});
    }
  }

  writeJsonAtomic(metaPath, meta);
  touchIndexEntry(store, assetId, meta);
  return { assetId, meta };
}

function deleteAsset({ assetId, store }) {
  const rootFolder = store.get('rootFolder', '');
  const assetDir = resolveExistingAssetDir(rootFolder, assetId);
  if (fs.existsSync(assetDir)) {
    fs.rmSync(assetDir, { recursive: true, force: true });
  }
  removeIndexEntry(store, assetId);
  return { assetId };
}

async function createAssetShell({ originUrl, assetName, selectedImageUrl, tags, isAdult, store }) {
  const rootFolder = store.get('rootFolder', '');
  if (!rootFolder) throw new Error('Root folder not configured.');
  if (!fs.existsSync(rootFolder)) throw new Error('Root folder does not exist: ' + rootFolder);

  const assetId  = allocateAssetId(rootFolder, extractAssetId(originUrl));
  const assetDir = resolveInsideRoot(rootFolder, assetId);
  if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });

  if (tags && tags.length) registerTags(tags, store);

  // Download thumbnail immediately
  let thumbnailPath = null;
  if (selectedImageUrl) {
    const rawPath = path.join(assetDir, 'thumbnail_raw.tmp');
    thumbnailPath = path.join(assetDir, 'thumbnail.png');
    try {
      await downloadFile(selectedImageUrl, rawPath);
      await sharp(rawPath)
        .resize(500, 500, { fit: 'cover', position: 'centre' })
        .png()
        .toFile(thumbnailPath);
      fs.unlinkSync(rawPath);
    } catch (e) {
      console.warn('Thumbnail failed:', e.message);
      fs.unlink(rawPath, () => {});
      thumbnailPath = null;
    }
  }

  const meta = {
    id: assetId,
    name: assetName || assetId,
    originUrl,
    files: [],
    thumbnail: thumbnailPath ? 'thumbnail.png' : null,
    importedAt: new Date().toISOString(),
    tags: tags || [],
    isAdult: !!isAdult,
    downloadStatus: 'pending',
  };
  writeJsonAtomic(path.join(assetDir, 'meta.json'), meta);
  touchIndexEntry(store, assetId, meta);
  return { assetId, assetDir, meta };
}

function finalizeAssetDownload({ assetId, filePath, store }) {
  const rootFolder = store.get('rootFolder', '');
  const assetDir   = resolveExistingAssetDir(rootFolder, assetId);
  const metaPath   = path.join(assetDir, 'meta.json');
  if (!fs.existsSync(metaPath)) throw new Error('Asset not found: ' + assetId);

  const requestedName = sanitizeExternalFilename(path.basename(filePath));
  const extension = path.extname(requestedName);
  const baseName = path.basename(requestedName, extension);
  let savedName = requestedName;
  let suffix = 2;
  while (fs.existsSync(path.join(assetDir, savedName))) {
    const suffixText = `-${suffix++}`;
    savedName = sanitizeExternalFilename(`${baseName.slice(0, 180 - extension.length - suffixText.length)}${suffixText}${extension}`);
  }
  const destFile = path.join(assetDir, savedName);
  const sameFile = path.resolve(filePath) === path.resolve(destFile);
  if (!sameFile) fs.copyFileSync(filePath, destFile, fs.constants.COPYFILE_EXCL);

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (!Array.isArray(meta.files)) meta.files = [];
  if (!meta.files.includes(savedName)) meta.files.push(savedName);
  meta.downloadStatus = 'complete';
  try {
    writeJsonAtomic(metaPath, meta);
    if (!sameFile) fs.unlinkSync(filePath);
  } catch (error) {
    if (!sameFile) { try { fs.unlinkSync(destFile); } catch {} }
    throw error;
  }
  touchIndexEntry(store, assetId, meta);
  return { assetId, fileName: savedName, meta };
}

function appendToExistingBoothAsset({ originUrl, filePath, store }) {
  const existing = findExistingBoothAsset({ originUrl, store });
  if (!existing) return null;
  return finalizeAssetDownload({ assetId: existing.id, filePath, store });
}

module.exports = {
  importAsset, updateAsset, deleteAsset, getAssets, extractAssetId, downloadFile, registerTags,
  extractBoothItemId, findExistingBoothAsset,
  createAssetShell, finalizeAssetDownload, appendToExistingBoothAsset,
  discardIncompleteDownload, cleanupIncompleteDownloads,
  touchIndexEntry, reconcileIndex,
};
