const { sanitizeExternalFilename } = require('./security/pathPolicy');
function parseDownloadProtocol(raw) {
  if (typeof raw !== 'string' || raw.length > 8192) throw new Error('Invalid protocol URL');
  const u = new URL(raw); const scheme = u.protocol.toLowerCase();
  if (!['booth-library-manager:', 'vroid.closet:', 'bunslm:'].includes(scheme)) throw new Error('Unsupported protocol');
  const params = new URLSearchParams(u.search); const allowed = new Set(['dlurl', 'downloadable_filename', 'item_id', 'client', 'order_id', 'variation_id']);
  for (const key of params.keys()) if (!allowed.has(key)) throw new Error('Unknown protocol parameter');
  for (const key of ['dlurl', 'item_id']) if (params.getAll(key).length > 1) throw new Error('Duplicate protocol parameter');
  const dlurl = params.get('dlurl'); if (!dlurl) throw new Error('Missing download URL');
  const download = new URL(dlurl); if (download.protocol !== 'https:' || download.username || download.password) throw new Error('Invalid download URL');
  const itemId = params.get('item_id'); if (itemId && !/^\d{1,20}$/.test(itemId)) throw new Error('Invalid item id');
  const filename = sanitizeExternalFilename(params.get('downloadable_filename') || 'download.zip', ['.zip', '.rar', '.7z', '.unitypackage', '.fbx', '.blend', '.glb', '.gltf']);
  return { scheme: scheme.slice(0, -1), dlurl: download.href, itemId, filename };
}
function parseImportIntent(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) throw new Error('Invalid import intent');
  const u = new URL(raw); if (!['bunslm:', 'rslimman:'].includes(u.protocol.toLowerCase()) || u.hostname !== 'import') throw new Error('Unsupported import intent');
  const originUrl = new URL(u.searchParams.get('origin_url') || u.searchParams.get('originUrl') || '');
  if (originUrl.protocol !== 'https:' || originUrl.username || originUrl.password) throw new Error('Invalid origin URL');
  const filename = sanitizeExternalFilename(u.searchParams.get('filename') || u.searchParams.get('file') || 'download.zip');
  return { originUrl: originUrl.href, filename };
}
module.exports = { parseDownloadProtocol, parseImportIntent };
