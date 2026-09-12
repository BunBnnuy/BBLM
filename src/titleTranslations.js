const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { request } = require('./httpClient');
const { resolveExistingAssetDir } = require('./security/pathPolicy');
const { writeJsonAtomic } = require('./atomicFs');

const DAY = 24 * 60 * 60 * 1000;
// Include kanji-only titles and half-width katakana, but not Latin-only names.
function needsTranslation(name) {
  return typeof name === 'string' && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(name);
}

function displayTitle(asset, enabled) {
  const saved = asset.titleTranslation;
  return enabled && saved?.source === asset.name && saved.status === 'complete'
    ? saved.text : asset.name;
}

async function translateTitle(source) {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', source);
  url.searchParams.set('langpair', 'ja|en');
  const response = await request(url.href, { timeoutMs: 15000, maxBytes: 128 * 1024, maxRedirects: 0 });
  const data = JSON.parse(response.body.toString('utf8'));
  if (data.quotaFinished === true || data.quotaFinished === 'true' || Number(data.responseStatus) === 429 || /(?:used all available free translations|daily limit|quota exceeded)/i.test(`${data.responseDetails || ''} ${data.responseData?.translatedText || ''}`)) throw new Error('Translation quota reached');
  const text = data.responseData?.translatedText;
  if (Number(data.responseStatus) !== 200 || typeof text !== 'string' || !text.trim() || text.length > 4000) {
    throw new Error('Invalid translation response');
  }
  return text.trim();
}

class TitleTranslations {
  constructor({ store, assets, translate = translateTitle, now = Date.now, pause = () => new Promise(resolve => setTimeout(resolve, 1000)), onSaved = () => {}, commit, onStatus = () => {} }) {
    Object.assign(this, { store, assets, translate, now, pause, onSaved, commit, onStatus });
    this.queue = new Map();
    this.running = null;
  }

  enqueue(root, id) {
    if (!this.store.get('translatedTitlesEnabled', false)) return;
    if (this.blocked()) return;
    this.queue.set(JSON.stringify([root, id]), { root, id });
    if (!this.running) {
      this.running = Promise.resolve().then(() => this.drain()).finally(() => { this.running = null; });
    }
  }

  scan() {
    if (!this.store.get('translatedTitlesEnabled', false)) return;
    if (this.blocked()) return;
    const root = this.store.get('rootFolder', '');
    for (const asset of this.assets.getAssets(this.store)) {
      if (this.eligible(asset)) this.enqueue(root, asset.id);
    }
  }

  eligible(meta) {
    if (meta.downloadStatus === 'pending' || !needsTranslation(meta.name)) return false;
    const saved = meta.titleTranslation;
    return saved?.source !== meta.name || (!['complete', 'too-long'].includes(saved.status) && (saved.retryAt || 0) <= this.now());
  }

  blocked() {
    const retryAt = this.store.get('titleTranslationsBudget', {}).blockedUntil || 0;
    if (retryAt <= this.now()) return false;
    this.onStatus({ state: 'paused', retryAt });
    return true;
  }

  async drain() {
    while (this.queue.size) {
      if (this.blocked()) { this.queue.clear(); return; }
      const [key, item] = this.queue.entries().next().value;
      this.queue.delete(key);
      if (!this.store.get('translatedTitlesEnabled', false)) { this.queue.clear(); break; }
      if (item.root !== this.store.get('rootFolder', '')) continue;
      try { await this.process(item); } catch (error) { console.warn('[titleTranslations]', error.message); }
    }
    if (!this.blocked()) this.onStatus({ state: 'idle' });
  }

  async process({ root, id }) {
    const metaPath = path.join(resolveExistingAssetDir(root, id), 'meta.json');
    const read = () => JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const meta = read();
    if (!this.eligible(meta)) return;
    const source = meta.name;
    const save = async state => {
      if (this.commit) return this.commit({ root, id, source, state });
      // Another save, scan, deletion, or root change may occur during the request.
      if (root !== this.store.get('rootFolder', '')) return;
      const latest = read();
      if (latest.name !== source) return;
      latest.titleTranslation = { source, ...state };
      writeJsonAtomic(metaPath, latest);
      this.assets.touchIndexEntry(this.store, id, latest);
      this.onSaved();
    };
    if (Buffer.byteLength(source, 'utf8') > 500) { await save({ status: 'too-long' }); return; }
    const hash = createHash('sha256').update(source).digest('hex');
    const cacheKey = `titleTranslationsCache.${hash}`;
    const cached = this.store.get(cacheKey);
    if (cached?.status === 'complete') { await save(cached); return; }
    if (cached?.retryAt > this.now()) return;
    let budget = this.store.get('titleTranslationsBudget', { start: this.now(), used: 0 });
    if (!Number.isFinite(budget.start) || !Number.isFinite(budget.used)) budget = { start: this.now(), used: 0, blockedUntil: budget.blockedUntil };
    if (this.now() >= budget.start + DAY) budget = { start: this.now(), used: 0, blockedUntil: budget.blockedUntil };
    const count = Array.from(source).length;
    if (budget.blockedUntil > this.now()) return;
    if (budget.used + count > 5000) {
      this.store.set('titleTranslationsBudget', { ...budget, blockedUntil: Math.max(budget.start + DAY, this.now() + 8 * 60 * 60 * 1000) });
      this.blocked();
      return;
    }
    // Persist before sending: restarts and repeated saves must not repeat an attempt.
    const attempt = { status: 'pending', retryAt: this.now() + DAY };
    await save(attempt);
    if (!this.store.get('translatedTitlesEnabled', false) || root !== this.store.get('rootFolder', '')) return;
    this.store.set(cacheKey, attempt);
    this.store.set('titleTranslationsBudget', { ...budget, used: budget.used + count });
    try {
      this.onStatus({ state: 'translating', item: source });
      const text = await this.translate(source);
      const result = { status: 'complete', text };
      this.store.set(cacheKey, result);
      await save(result);
    } catch {
      const failed = { status: 'failed', retryAt: this.now() + DAY };
      // Also stop the queue on network, service, or quota errors.
      const current = this.store.get('titleTranslationsBudget');
      this.store.set('titleTranslationsBudget', { ...current, blockedUntil: this.now() + DAY });
      this.store.set(cacheKey, failed);
      await save(failed);
      this.blocked();
      this.queue.clear();
      return;
    }
    await this.pause();
  }
}

module.exports = { TitleTranslations, needsTranslation, displayTitle, translateTitle };
