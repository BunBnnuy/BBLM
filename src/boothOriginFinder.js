'use strict';

const path = require('path');
const cheerio = require('cheerio');
const { fetchHtml } = require('./httpClient');

const BOOTH_ITEM_RE = /https?:\/\/(?:[a-z0-9-]+\.)?booth\.pm\/(?:[a-z]{2}\/)?items\/(\d+)/gi;
const BOOTH_SHOP_RE = /https?:\/\/([a-z0-9-]+)\.booth\.pm(?:\/[^\s"'<>]*)?/gi;
const GENERIC_TERMS = new Set([
  'assets', 'asset', 'package', 'packages', 'unitypackage', 'unity', 'readme', 'license',
  'texture', 'textures', 'tex', 'material', 'materials', 'mat', 'prefab', 'fbx', 'model',
  'models', 'animation', 'animations', 'resources', 'resource', 'editor', 'plugins', 'version',
  'ver', 'free', 'quest', 'pc', 'setup', 'data',
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanText(value) {
  return String(value || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return cleanText(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function usefulTokens(value) {
  return normalize(value).split(' ').filter(token => token.length > 1 && !GENERIC_TERMS.has(token) && !/^v?\d+(?:\.\d+)*$/.test(token));
}

function pathnameTokens(value) {
  return normalize(value).split(' ').filter(token => token.length > 1 && token !== 'free' && !/^v?\d+(?:\.\d+)*$/.test(token));
}

function archiveSearchName(archivePath) {
  return path.basename(String(archivePath || ''), path.extname(String(archivePath || '')))
    .replace(/(?:^|[_\s-])\d{5,9}(?=$|[_\s.-])/g, ' ')
    .replace(/(?:^|[_\s-])v(?:er)?\.?\s*\d+(?:[._-]\d+)*/gi, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/[()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pathnameShopAndTitle(value) {
  const segments = cleanText(value).split(/[\\/]/).filter(Boolean);
  const assetsIndex = segments.findIndex(segment => normalize(segment) === 'assets');
  if (assetsIndex < 0 || segments.length <= assetsIndex + 2) return [];
  const shopTokens = pathnameTokens(segments[assetsIndex + 1]);
  const titleTokens = pathnameTokens(segments[assetsIndex + 2].replace(/\.[^.]+$/, ''));
  return unique([...shopTokens, ...titleTokens]);
}

function extractBoothEvidence({ archivePath, pathnames = [], metadataTexts = [] }) {
  const sources = [archivePath, ...pathnames, ...metadataTexts].map(cleanText);
  const itemIds = [];
  const itemUrls = [];
  const shopUrls = [];
  for (const source of sources) {
    BOOTH_ITEM_RE.lastIndex = 0;
    let match;
    while ((match = BOOTH_ITEM_RE.exec(source))) {
      itemIds.push(match[1]);
      itemUrls.push(`https://booth.pm/en/items/${match[1]}`);
    }
    BOOTH_SHOP_RE.lastIndex = 0;
    while ((match = BOOTH_SHOP_RE.exec(source))) shopUrls.push(`https://${match[1]}.booth.pm/`);
  }

  const fileName = path.basename(String(archivePath || ''));
  const filenameItemIds = [];
  for (const match of fileName.matchAll(/(?:^|[_\s-])(\d{5,9})(?=$|[_\s.-])/g)) {
    filenameItemIds.push(match[1]);
    itemIds.push(match[1]);
  }

  const name = archiveSearchName(archivePath);
  const pathnameTerms = [];
  const pathnameQueries = [];
  for (const pathname of pathnames.slice(0, 8)) {
    const segments = cleanText(pathname).split(/[\\/]/).map(segment => segment.replace(/\.[^.]+$/, ''));
    const shopAndTitle = pathnameShopAndTitle(pathname);
    if (shopAndTitle.length >= 2) pathnameQueries.push(shopAndTitle.join(' '));
    for (const segment of segments) {
      const tokens = usefulTokens(segment);
      if (tokens.length && tokens.length <= 6) pathnameTerms.push(tokens.join(' '));
    }
  }
  const nameTokens = usefulTokens(name);
  const supporting = unique(pathnameTerms).filter(term => !nameTokens.every(token => normalize(term).includes(token)));
  const pathnameQuery = unique(pathnameQueries)[0] || '';
  const query = cleanText(pathnameQuery || nameTokens.join(' ') || supporting[0]).slice(0, 80);

  return {
    itemIds: unique(itemIds),
    filenameItemIds: unique(filenameItemIds),
    itemUrls: unique(itemUrls),
    shopUrls: unique(shopUrls),
    query,
    terms: unique([...usefulTokens(pathnameQuery), ...nameTokens, ...supporting.flatMap(usefulTokens)]).slice(0, 20),
    metadataFilesRead: metadataTexts.length,
  };
}

function filenameIdCandidates(evidence) {
  return (evidence.filenameItemIds || []).map(itemId => ({
    itemId,
    url: `https://booth.pm/en/items/${itemId}`,
    title: `BOOTH item #${itemId}`,
    shop: '',
    confidence: 'medium',
    score: 70,
    reason: 'BOOTH item ID found in the archive name; review because it can identify a dependency',
  }));
}

function metadataCandidates(evidence) {
  const filenameItemIds = evidence.filenameItemIds || [];
  return (evidence.itemIds || []).filter(itemId => !filenameItemIds.includes(itemId)).map(itemId => ({
    itemId,
    url: `https://booth.pm/en/items/${itemId}`,
    title: `BOOTH item #${itemId}`,
    shop: '',
    confidence: 'medium',
    score: 70,
    reason: 'BOOTH URL found in local metadata; review because it can be a dependency',
  }));
}

function autoSelectedCandidate(origin) {
  if (!origin || !['exact', 'found'].includes(origin.status)) return null;
  return (origin.candidates || []).find(candidate => candidate.confidence === 'exact' || candidate.confidence === 'high') || null;
}

function parseBoothSearch(html, query = '') {
  const $ = cheerio.load(html);
  const queryTokens = usefulTokens(query);
  const candidates = [];
  $('.item-card').each((index, element) => {
    const card = $(element);
    const titleLink = card.find('a.item-card__title-anchor--multiline').first();
    const url = titleLink.attr('href') || card.find('a[href*="/items/"]').first().attr('href') || '';
    const idMatch = url.match(/\/items\/(\d+)/);
    if (!idMatch) return;
    const title = cleanText(titleLink.text());
    const shopLink = card.find('a.item-card__shop-name-anchor').first();
    const shop = cleanText(shopLink.text());
    const haystack = normalize(`${title} ${shop}`);
    const matched = queryTokens.filter(token => haystack.includes(token));
    let score = queryTokens.length ? Math.round((matched.length / queryTokens.length) * 75) : 0;
    if (queryTokens.length > 1 && haystack.includes(queryTokens.join(' '))) score += 15;
    score += Math.max(0, 10 - index);
    const confidence = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';
    candidates.push({
      itemId: idMatch[1],
      url: `https://booth.pm/en/items/${idMatch[1]}`,
      title: title || `BOOTH item #${idMatch[1]}`,
      shop,
      shopUrl: shopLink.attr('href') || '',
      confidence,
      score,
      reason: matched.length ? `Matched: ${matched.join(', ')}` : 'BOOTH search result',
    });
  });
  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}

async function searchBooth(query) {
  if (!query) return [];
  const url = `https://booth.pm/en/search/${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html,application/xhtml+xml' } });
  return parseBoothSearch(html, query);
}

function initialOrigin(result) {
  const evidence = result.originEvidence || extractBoothEvidence({
    archivePath: result.archive,
    pathnames: result.pathnames || [result.content],
  });
  const filenameCandidates = filenameIdCandidates(evidence);
  const localCandidates = metadataCandidates(evidence);
  return {
    queryVersion: 3,
    status: 'ready',
    query: evidence.query,
    candidates: [...filenameCandidates, ...localCandidates]
      .filter((candidate, index, list) => list.findIndex(item => item.itemId === candidate.itemId) === index),
    evidence: {
      itemIds: evidence.itemIds,
      filenameItemIds: evidence.filenameItemIds,
      shopUrls: evidence.shopUrls,
      metadataFilesRead: evidence.metadataFilesRead || 0,
    },
  };
}

module.exports = {
  archiveSearchName,
  autoSelectedCandidate,
  filenameIdCandidates,
  extractBoothEvidence,
  initialOrigin,
  metadataCandidates,
  pathnameShopAndTitle,
  parseBoothSearch,
  searchBooth,
};
