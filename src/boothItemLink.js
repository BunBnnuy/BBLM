'use strict';

// Reads a Booth item link pasted into the web library. The web server validates
// it before the desktop app resolves the download. Pure helpers: no Electron,
// no network, so the server and the test suite can require this file.

// "/items/123" and "/en/items/123" (or any two-letter locale) are both valid.
const ITEM_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?items\/(\d{1,20})\/?$/i;
// Booth download deeplinks end in "/deeplink" and carry the client parameter.
const DEEPLINK_PATH = /\/deeplink\/?$/i;
const MAX_LENGTH = 2048;

function isBoothHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'booth.pm' || host.endsWith('.booth.pm');
}

/**
 * Parses a Booth item link.
 * Accepts https://booth.pm/en/items/123, https://booth.pm/items/123 and
 * https://shop.booth.pm/items/123 (query and fragment are ignored).
 * Returns { itemId, itemUrl }. Throws Error with a user-facing message otherwise.
 */
function parseBoothItemUrl(value) {
  if (typeof value !== 'string') throw new Error('Paste a Booth item link.');
  const raw = value.trim();
  if (!raw || raw.length > MAX_LENGTH) throw new Error('Paste a Booth item link.');
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw new Error('Paste a Booth item link.');

  let url;
  try { url = new URL(raw); } catch { throw new Error('Paste a Booth item link.'); }
  if (url.protocol !== 'https:') throw new Error('Booth links must start with https://');
  if (url.username || url.password) throw new Error('Paste a Booth item link.');
  if (!isBoothHost(url.hostname)) throw new Error('This is not a Booth link.');

  const match = url.pathname.match(ITEM_PATH);
  if (!match) throw new Error('Paste a Booth item link, for example https://booth.pm/en/items/1234567');

  const itemId = match[1];
  return { itemId, itemUrl: `https://booth.pm/en/items/${itemId}` };
}

/**
 * Parses a Booth download deeplink, the link the Free Items tab already uses:
 * https://booth.pm/downloadables/123/deeplink?client=booth-library-manager...
 * The desktop app opens it with the saved Booth session and catches the
 * booth-library-manager:// redirect. Returns { url }.
 */
function parseBoothDownloadUrl(value) {
  if (typeof value !== 'string') throw new Error('Paste a Booth download link.');
  const raw = value.trim();
  if (!raw || raw.length > MAX_LENGTH) throw new Error('Paste a Booth download link.');
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw new Error('Paste a Booth download link.');

  let url;
  try { url = new URL(raw); } catch { throw new Error('Paste a Booth download link.'); }
  if (url.protocol !== 'https:') throw new Error('Booth links must start with https://');
  if (url.username || url.password) throw new Error('Paste a Booth download link.');
  if (!isBoothHost(url.hostname)) throw new Error('This is not a Booth link.');
  if (!DEEPLINK_PATH.test(url.pathname)) throw new Error('Paste a Booth item or download link.');

  return { url: url.href };
}

module.exports = { parseBoothItemUrl, parseBoothDownloadUrl, isBoothHost };
