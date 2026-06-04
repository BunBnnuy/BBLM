const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const sharp = require('sharp');

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

function normalizeUrl(url) {
  // Fix protocol-relative URLs (//cdn.example.com/...) which break on Windows
  if (url.startsWith('//')) return 'https:' + url;
  return url;
}

function downloadFile(url, destPath) {
  url = normalizeUrl(url);
  return new Promise((resolve, reject) => {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return reject(new Error('Invalid URL for download: ' + url));
    }
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    const options = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    };
    proto.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(destPath, () => {});
        const redirectUrl = normalizeUrl(res.headers.location.startsWith('/')
          ? new URL(res.headers.location, url).href
          : res.headers.location);
        return downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error('HTTP ' + res.statusCode + ' downloading ' + url));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function importAsset({ originUrl, filePath, selectedImageUrl, assetName, store }) {
  const rootFolder = store.get('rootFolder', '');
  if (!rootFolder) throw new Error('Root folder not configured.');
  if (!fs.existsSync(rootFolder)) throw new Error('Root folder does not exist: ' + rootFolder);

  const assetId = extractAssetId(originUrl);
  const assetDir = path.join(rootFolder, assetId);

  if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });

  // Move downloaded file into asset folder (copy+delete for cross-drive transfers)
  const destFile = path.join(assetDir, path.basename(filePath));
  try {
    fs.renameSync(filePath, destFile);
  } catch (err) {
    if (err.code === 'EXDEV') {
      fs.copyFileSync(filePath, destFile);
      fs.unlinkSync(filePath);
    } else {
      throw err;
    }
  }

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
      console.warn('Thumbnail processing failed:', e.message);
      fs.unlink(rawPath, () => {});
      thumbnailPath = null;
    }
  }

  // Write metadata
  const meta = {
    id: assetId,
    name: assetName || assetId,
    originUrl,
    files: [path.basename(destFile)],
    thumbnail: thumbnailPath ? 'thumbnail.png' : null,
    importedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(assetDir, 'meta.json'), JSON.stringify(meta, null, 2));

  return { assetId, assetDir, meta };
}

function getAssets(store) {
  const rootFolder = store.get('rootFolder', '');
  if (!rootFolder || !fs.existsSync(rootFolder)) return [];

  const assets = [];
  for (const entry of fs.readdirSync(rootFolder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(rootFolder, entry.name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const assetDir = path.join(rootFolder, entry.name);
      if (meta.thumbnail) {
        meta.thumbnailPath = path.join(assetDir, meta.thumbnail);
      }
      assets.push(meta);
    } catch {
      // skip malformed entries
    }
  }
  return assets.sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
}

module.exports = { importAsset, getAssets, extractAssetId };
