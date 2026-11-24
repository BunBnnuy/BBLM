'use strict';

// Helpers for external download hosts used by the forum helper.
// The app only accepts the hosts listed here.

function classifyExternalUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  if (host === 'pixeldrain.com' || host === 'www.pixeldrain.com') {
    const match = url.pathname.match(/^\/(?:u|api\/file)\/([A-Za-z0-9_-]+)/);
    if (!match) return null;
    return { host: 'pixeldrain', id: match[1] };
  }

  if (host === 'forum.ripper.store' && url.pathname.startsWith('/hidelinks/')) {
    return { host: 'hidelink', id: '' };
  }

  if (host === 'workupload.com' || host === 'www.workupload.com') {
    const match = url.pathname.match(/^\/(?:file|archive)\/([A-Za-z0-9]+)/);
    if (!match) return null;
    return { host: 'workupload', id: match[1] };
  }

  return null;
}

function pixeldrainInfoUrl(id) {
  return `https://pixeldrain.com/api/file/${encodeURIComponent(id)}/info`;
}

function pixeldrainDownloadUrl(id) {
  return `https://pixeldrain.com/api/file/${encodeURIComponent(id)}?download`;
}

function filenameFromUrl(value, fallback = '') {
  try {
    const url = new URL(String(value));
    const base = decodeURIComponent(url.pathname.split('/').pop() || '');
    if (base && /\.[a-z0-9]{1,8}$/i.test(base)) return base;
  } catch {
    // Ignore malformed URLs.
  }
  return fallback;
}

module.exports = {
  classifyExternalUrl,
  pixeldrainInfoUrl,
  pixeldrainDownloadUrl,
  filenameFromUrl,
};
