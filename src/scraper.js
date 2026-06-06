const https = require('https');
const http = require('http');
const cheerio = require('cheerio');
const { URL } = require('url');

function fetchHtml(targetUrl) {
  return new Promise((resolve, reject) => {
    const proto = targetUrl.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    };

    proto.get(targetUrl, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, targetUrl).href;
        return fetchHtml(redirectUrl).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + targetUrl));
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function resolveUrl(src, base) {
  try {
    return new URL(src, base).href;
  } catch {
    return null;
  }
}

function isLikelyThumbnail(src) {
  const lower = src.toLowerCase();
  // Skip icons, SVGs, 1x1 tracking pixels, data URIs, etc.
  if (lower.startsWith('data:')) return false;
  if (lower.endsWith('.svg')) return false;
  if (lower.includes('icon') && !lower.includes('preview')) return false;
  if (lower.includes('logo') && !lower.includes('preview')) return false;
  if (lower.includes('avatar')) return false;
  return /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(src);
}

function extractNameFromUrl(originUrl) {
  try {
    const parts = new URL(originUrl).pathname.split('/').filter(Boolean);
    if (!parts.length) return '';
    const slug = parts[parts.length - 1].replace(/\.[^.]+$/, '');
    return slug.replace(/[-_]+/g, ' ').trim();
  } catch {
    return '';
  }
}

function cleanPageTitle(raw) {
  if (!raw) return '';
  // Strip common suffixes like "| ArtStation", "- Fab", "– Gumroad", etc.
  return raw
    .replace(/\s*[|\-–—]\s*.{2,40}$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBoothItemId(url) {
  try {
    const m = new URL(url).pathname.match(/\/items\/(\d+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

async function fetchBoothJson(itemId) {
  try {
    const body = await fetchHtml(`https://booth.pm/en/items/${itemId}.json`);
    return JSON.parse(body);
  } catch { return null; }
}

async function scrapePageMeta(originUrl) {
  let html;

  // ── Booth fast-path: use the JSON API for complete data ──────────────────
  const boothId = extractBoothItemId(originUrl);
  if (boothId) {
    const data = await fetchBoothJson(boothId);
    if (data) {
      const name = data.name || extractNameFromUrl(originUrl);
      const tags = Array.isArray(data.tags) ? data.tags.map(t => t.name).filter(Boolean) : [];
      const images = [];
      const seen = new Set();
      if (Array.isArray(data.images)) {
        for (const img of data.images) {
          const url = img.original || img.resized;
          if (url && !seen.has(url)) { seen.add(url); images.push({ url, source: 'booth-api' }); }
        }
      }
      return { name, images, tags };
    }
  }

  try {
    html = await fetchHtml(originUrl);
  } catch (err) {
    return { error: err.message, name: extractNameFromUrl(originUrl), images: [] };
  }

  const $ = cheerio.load(html);
  const base = originUrl;

  // ── Name: prefer og:title / twitter:title / <title>, fallback to URL slug ──
  const ogTitle = $('meta[property="og:title"]').attr('content') ||
                  $('meta[name="twitter:title"]').attr('content') || '';
  const pageTitle = $('title').first().text() || '';
  const rawName = ogTitle || cleanPageTitle(pageTitle) || extractNameFromUrl(originUrl);
  const name = rawName.trim();

  // ── Images ──
  const seen = new Set();
  const images = [];

  const metaSrcs = [];
  $('meta[property="og:image"], meta[name="og:image"]').each((_, el) => {
    const c = $(el).attr('content'); if (c) metaSrcs.push(c);
  });
  $('meta[name="twitter:image"]').each((_, el) => {
    const c = $(el).attr('content'); if (c) metaSrcs.push(c);
  });

  for (const src of metaSrcs) {
    const resolved = resolveUrl(src, base);
    if (resolved && !seen.has(resolved)) { seen.add(resolved); images.push({ url: resolved, source: 'meta' }); }
  }

  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
    if (!src) return;
    const resolved = resolveUrl(src, base);
    if (!resolved || seen.has(resolved)) return;
    if (!isLikelyThumbnail(resolved)) return;
    seen.add(resolved);
    images.push({ url: resolved, source: 'img', alt: $(el).attr('alt') || '' });
  });

  // ── Tags ──
  const tags = [];
  const tagsSeen = new Set();

  function addFoundTag(t) {
    t = t.trim();
    if (t && t.length < 80 && !tagsSeen.has(t)) { tagsSeen.add(t); tags.push(t); }
  }

  // Booth.pm: tag name is in the URL param (text is JS-rendered and empty)
  // href="...?tags%5B%5D=TagName" or "...?tags[]=TagName"
  $('a[href*="tags%5B%5D="], a[href*="tags[]="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    try {
      const u = new URL(href, base);
      const tag = u.searchParams.get('tags[]');
      if (tag) addFoundTag(decodeURIComponent(tag));
    } catch {
      // fallback: parse manually
      const m = href.match(/tags(?:%5B%5D|\[\])=([^&]+)/i);
      if (m) addFoundTag(decodeURIComponent(m[1]));
    }
  });

  // Generic: rel="tag" links (WordPress, etc.)
  $('a[rel="tag"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text) addFoundTag(text);
  });

  // Generic: common tag list patterns where text is available
  if (tags.length === 0) {
    $('ul.tags li a, .tag-list a, .tags a, [class*="tag-list"] a').each((_, el) => {
      addFoundTag($(el).text().trim());
    });
  }

  return { name, images, tags };
}

// Keep scrapeImages as a thin wrapper for backwards compat
async function scrapeImages(originUrl) {
  const result = await scrapePageMeta(originUrl);
  return result;
}

module.exports = { scrapeImages, scrapePageMeta, extractNameFromUrl, extractBoothItemId };
