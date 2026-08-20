const { URL } = require('url');
const { fetchHtml: secureFetchHtml } = require('./httpClient');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function fetchHtml(targetUrl, redirectCount = 0) {
  return secureFetchHtml(targetUrl, { headers: HEADERS, maxBytes: 5 * 1024 * 1024 });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Extract background-image URL from an inline style string */
function extractBgUrl(style) {
  if (!style) return '';
  const m = style.match(/background-image\s*:\s*url\(([^)]+)\)/);
  if (!m) return '';
  return m[1].replace(/^['"]|['"]$/g, '').trim();
}

/**
 * Scans an item page for free variations and BLM deeplink URLs.
 * Returns null if no ¥0 variation exists.
 * Returns { priceRange, deeplinkUrl } otherwise.
 *   priceRange – e.g. "¥0 – ¥300", or null when only one price level.
 *   deeplinkUrl – https://booth.pm/downloadables/.../deeplink?client=booth-library-manager...
 *                 Open via shell.openExternal so the browser handles auth → redirects to scheme.
 */
function getFreeVariationInfo(html) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);

  // Collect all variation prices
  const prices = new Set();
  $('.variation-price').each((_, el) => {
    const text = $(el).text().replace(/\s/g, '').replace(/,/g, '');
    const m = text.match(/(\d+)JPY/) || text.match(/¥(\d+)/) || text.match(/(\d+)円/);
    if (m) prices.add(parseInt(m[1], 10));
  });
  if (!prices.has(0)) return null;

  const sorted = [...prices].sort((a, b) => a - b);
  const priceRange = sorted.length > 1
    ? `¥${sorted[0]} – ¥${sorted[sorted.length - 1]}`
    : null;

  // Find the BLM deeplink URL from js-download-free-button data-dropdown-items
  let deeplinkUrl = null;
  $('.js-download-free-button').each((_, el) => {
    if (deeplinkUrl) return;
    const raw = $(el).attr('data-dropdown-items');
    if (!raw) return;
    try {
      const entries = JSON.parse(raw);
      const blm = entries.find(e => e.deeplinkDownloadableUrl && e.deeplinkDownloadableUrl.includes('client=booth-library-manager'));
      if (blm) deeplinkUrl = blm.deeplinkDownloadableUrl;
    } catch (_) {}
  });

  return { priceRange, deeplinkUrl };
}

/**
 * Scrape Booth.pm VRChat listing pages and find items that have a ¥0 variation.
 *
 * Step 1 – collect all items from listing page (name/thumbnail from data-product-* attrs).
 * Step 2 – visit each item page, check for a .variation-price of 0.
 *
 * @param {object} opts
 * @param {number}   opts.maxPages    - Maximum listing pages to fetch
 * @param {function} opts.onProgress  - Called with progress info objects
 * @param {function} opts.onItem      - Called with { itemId, name, thumbnailUrl, boothUrl }
 * @param {function} opts.isCancelled - Returns true if the scan should stop
 * @returns {{ scannedCount, foundCount }}
 */
async function scrapeFreeItems({ maxPages = 5, onProgress, onItem, isCancelled }) {
  const cheerio = require('cheerio');
  let scannedCount = 0;
  let foundCount = 0;

  for (let page = 1; page <= maxPages; page++) {
    if (isCancelled && isCancelled()) break;

    const listUrl = page === 1
      ? 'https://booth.pm/en/items?tags%5B%5D=VRChat&sort=new'
      : `https://booth.pm/en/items?page=${page}&sort=new&tags%5B%5D=VRChat`;

    if (onProgress) onProgress({ phase: 'fetching-page', page, maxPages, scannedCount, foundCount });

    if (page > 1) await delay(1500 + Math.random() * 1000);
    if (isCancelled && isCancelled()) break;

    let listHtml;
    try {
      listHtml = await fetchHtml(listUrl);
    } catch (err) {
      console.error(`[free-scraper] failed to fetch listing page ${page}:`, err.message);
      break;
    }

    const $ = cheerio.load(listHtml);

    // Collect all items on this listing page
    const items = [];
    $('[data-product-id]').each((_, el) => {
      const container = $(el);
      const itemId = parseInt(container.attr('data-product-id'), 10);
      if (!itemId) return;
      const name = container.attr('data-product-name') || `Item ${itemId}`;
      const thumbEl = container.find('a.item-card__thumbnail-image').not('[class*="!hidden"]').first();
      const thumbnailUrl = extractBgUrl(thumbEl.attr('style') || '') || thumbEl.attr('data-original') || '';
      items.push({ itemId, name, thumbnailUrl });
    });

    // Visit each item page to check for a free variation
    for (const item of items) {
      if (isCancelled && isCancelled()) break;

      scannedCount++;
      if (onProgress) onProgress({ phase: 'checking-item', page, maxPages, itemId: item.itemId, scannedCount, foundCount });

      // Polite random delay 3–5 seconds between item page requests
      await delay(3000 + Math.random() * 2000);
      if (isCancelled && isCancelled()) break;

      let itemHtml;
      try {
        itemHtml = await fetchHtml(`https://booth.pm/en/items/${item.itemId}`);
      } catch (err) {
        console.warn(`[free-scraper] failed to fetch item ${item.itemId}:`, err.message);
        continue;
      }

      const freeInfo = getFreeVariationInfo(itemHtml);
      if (!freeInfo) continue;

      foundCount++;
      console.log(`[free-scraper] free variation found: ${item.itemId} "${item.name}" range="${freeInfo.priceRange}"`);

      const result = { ...item, priceRange: freeInfo.priceRange, deeplinkUrl: freeInfo.deeplinkUrl, boothUrl: `https://booth.pm/en/items/${item.itemId}` };
      if (onItem) onItem(result);
      if (onProgress) onProgress({ phase: 'found-item', page, maxPages, itemId: item.itemId, scannedCount, foundCount });
    }

    if (isCancelled && isCancelled()) break;
  }

  return { scannedCount, foundCount };
}

module.exports = { scrapeFreeItems };
