'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const sharp = require('sharp');
const { getAssets } = require('./assetManager');
const { writeJsonAtomic } = require('./atomicFs');
const { validateUrl } = require('./security/networkPolicy');

const MAX_SNAPSHOT_BYTES = 96 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 512 * 1024;

function cleanText(value, maxLength) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength)
    : '';
}

function publicAssetId(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function publicOriginUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.href.slice(0, 2048)
      : null;
  } catch {
    return null;
  }
}

function sourceLabel(value) {
  try {
    const hostname = new URL(String(value)).hostname.toLowerCase();
    if (hostname === 'booth.pm' || hostname.endsWith('.booth.pm')) return 'BOOTH';
    if (hostname === 'gumroad.com' || hostname.endsWith('.gumroad.com')) return 'Gumroad';
    if (hostname === 'jinxxy.com' || hostname.endsWith('.jinxxy.com')) return 'Jinxxy';
    return hostname.replace(/^www\./, '').slice(0, 40) || 'Library';
  } catch {
    return 'Library';
  }
}

function publicFileName(value) {
  const raw = cleanText(value, 500);
  if (!raw || path.isAbsolute(raw) || path.win32.isAbsolute(raw) || path.posix.isAbsolute(raw)) return null;
  const parts = raw.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.some((part) => part === '..')) return null;
  const relative = parts.join('/').slice(0, 260);
  return ['meta.json', 'thumbnail.png', 'thumbnail_raw.tmp'].includes(relative.toLowerCase()) ? null : relative;
}

async function encodeThumbnail(thumbnailPath) {
  if (!thumbnailPath || !fs.existsSync(thumbnailPath)) return null;
  const bytes = await sharp(thumbnailPath)
    .rotate()
    .resize(720, 540, { fit: 'cover', position: 'centre', withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  if (!bytes.length || bytes.length > MAX_THUMBNAIL_BYTES) throw new Error('A showcase thumbnail exceeds the 512 KB limit.');
  return { mimeType: 'image/jpeg', data: bytes.toString('base64') };
}

async function buildShowcaseSnapshot({ assets, hiddenIds = [], title = "BB's Library", description = 'A curated collection of avatars, worlds, props, and tools.' }) {
  const hidden = new Set(hiddenIds.map(String));
  const publicAssets = [];
  for (const asset of assets) {
    if (!asset || hidden.has(String(asset.id)) || asset.isAdult || asset.freeItemPending) continue;
    const name = cleanText(asset.name, 160);
    if (!name) continue;
    const files = [...new Set((Array.isArray(asset.files) ? asset.files : []).map(publicFileName).filter(Boolean))].slice(0, 1000);
    const tags = [...new Set((Array.isArray(asset.tags) ? asset.tags : []).map((tag) => cleanText(tag, 40)).filter(Boolean))].slice(0, 40);
    publicAssets.push({
      id: publicAssetId(asset.id),
      name,
      source: sourceLabel(asset.originUrl),
      originUrl: publicOriginUrl(asset.originUrl),
      tags,
      files,
      thumbnail: await encodeThumbnail(asset.thumbnailPath),
    });
  }
  return {
    schemaVersion: 1,
    title: cleanText(title, 100) || "BB's Library",
    description: cleanText(description, 280) || 'A curated public asset catalog.',
    generatedAt: new Date().toISOString(),
    assets: publicAssets,
  };
}

async function createShowcaseSnapshot({ store, outputPath }) {
  const snapshot = await buildShowcaseSnapshot({
    assets: getAssets(store),
    hiddenIds: store.get('hiddenAssets', []),
    title: store.get('showcaseTitle', "BB's Library"),
    description: store.get('showcaseDescription', 'A curated collection of avatars, worlds, props, and tools.'),
  });
  writeJsonAtomic(outputPath, snapshot, { mode: 0o600 });
  const bytes = fs.statSync(outputPath).size;
  if (bytes > MAX_SNAPSHOT_BYTES) {
    fs.rmSync(outputPath, { force: true });
    throw new Error('The showcase snapshot exceeds the 96 MB upload limit.');
  }
  return { outputPath, assetCount: snapshot.assets.length, generatedAt: snapshot.generatedAt, bytes };
}

function normalizePublishUrl(value) {
  const parsed = new URL(String(value));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('The showcase URL must be a public HTTPS address.');
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  if (!parsed.pathname.endsWith('/api/publish')) parsed.pathname = `${parsed.pathname}/api/publish`.replace(/\/+/g, '/');
  return parsed.href;
}

async function publishShowcaseSnapshot({ publishUrl, token, snapshotPath }) {
  if (typeof token !== 'string' || token.length < 24) throw new Error('A valid showcase publishing token is required.');
  const endpoint = normalizePublishUrl(publishUrl);
  const checked = await validateUrl(endpoint);
  const stat = fs.statSync(snapshotPath);
  if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) throw new Error('The showcase snapshot is invalid or too large.');

  return new Promise((resolve, reject) => {
    const request = https.request(checked.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': stat.size,
        'User-Agent': 'BBLM-Showcase-Publisher/1',
      },
      lookup: (_host, options, callback) => {
        const entries = checked.addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
        if (options && options.all) return callback(null, entries);
        callback(null, entries[0].address, entries[0].family);
      },
    }, (response) => {
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > 1024 * 1024) request.destroy(new Error('Showcase server response is too large.'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(typeof payload.error === 'string' ? payload.error : `Showcase server returned HTTP ${response.statusCode}.`));
        }
        resolve(payload);
      });
    });
    request.setTimeout(120000, () => request.destroy(new Error('Showcase upload timed out.')));
    request.on('error', reject);
    fs.createReadStream(snapshotPath).on('error', reject).pipe(request);
  });
}

module.exports = {
  buildShowcaseSnapshot,
  createShowcaseSnapshot,
  normalizePublishUrl,
  publishShowcaseSnapshot,
  publicFileName,
};
