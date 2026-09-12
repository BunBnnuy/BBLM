const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TitleTranslations, needsTranslation, displayTitle } = require('../src/titleTranslations');

function setup(t, names, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bblm-translations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const values = new Map([['rootFolder', root], ['translatedTitlesEnabled', true]]);
  const store = { get: (k, fallback) => values.has(k) ? values.get(k) : fallback, set: (k, v) => values.set(k, v) };
  const read = id => JSON.parse(fs.readFileSync(path.join(root, id, 'meta.json'), 'utf8'));
  const write = (id, meta) => fs.writeFileSync(path.join(root, id, 'meta.json'), JSON.stringify(meta));
  names.forEach((name, i) => {
    const id = String(i);
    fs.mkdirSync(path.join(root, id));
    write(id, { id, name, tags: [], files: ['asset.zip'] });
  });
  const calls = [];
  const assets = { getAssets: () => names.map((_, i) => read(String(i))), touchIndexEntry: () => {} };
  const config = { store, assets, pause: async () => {}, translate: async source => { calls.push(source); return 'English title'; }, ...options };
  const worker = new TitleTranslations(config);
  return { root, store, read, write, calls, worker, config };
}

test('only titles with Japanese script need translation; display preserves originals', () => {
  for (const title of ['Avatar Dress', 'VRChat 123', 'Café', '', null]) assert.equal(needsTranslation(title), false);
  for (const title of ['かわいい服', '衣装', 'アバター', 'ｱﾊﾞﾀｰ']) assert.equal(needsTranslation(title), true);
  const asset = { name: '衣装', titleTranslation: { source: '衣装', status: 'complete', text: 'Outfit' } };
  assert.equal(displayTitle(asset, true), 'Outfit');
  assert.equal(displayTitle(asset, false), '衣装');
  assert.equal(displayTitle({ ...asset, name: 'New name' }, true), 'New name');
});

test('saved results avoid duplicate requests across saves, items, and restarts', async t => {
  const h = setup(t, ['衣装', '衣装', 'English']);
  h.worker.scan();
  h.worker.scan();
  await h.worker.running;
  assert.deepEqual(h.calls, ['衣装']);
  assert.equal(h.read('0').name, '衣装');
  assert.equal(h.read('1').titleTranslation.text, 'English title');
  const restarted = new TitleTranslations(h.config);
  restarted.scan();
  await restarted.running;
  assert.equal(h.calls.length, 1);
});

test('queue is sequential and merges translation into the latest metadata', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let active = 0, maximum = 0;
  const h = setup(t, ['衣装', '髪型'], { translate: async () => {
    maximum = Math.max(maximum, ++active);
    await gate;
    active--;
    return 'Translated';
  } });
  h.worker.scan();
  await new Promise(resolve => setImmediate(resolve));
  h.write('0', { ...h.read('0'), tags: ['new tag'] });
  release();
  await h.worker.running;
  assert.equal(maximum, 1);
  assert.deepEqual(h.read('0').tags, ['new tag']);
  assert.equal(h.read('1').titleTranslation.text, 'Translated');
});

test('renames during translation do not receive the old translation', async t => {
  let release;
  const h = setup(t, ['衣装'], { translate: () => new Promise(resolve => { release = resolve; }) });
  h.worker.scan();
  await new Promise(resolve => setImmediate(resolve));
  h.write('0', { ...h.read('0'), name: 'New English name' });
  release('Outfit');
  await h.worker.running;
  assert.equal(displayTitle(h.read('0'), true), 'New English name');
});

test('disabled, pending downloads, and oversized titles do not send requests', async t => {
  const h = setup(t, ['衣装', 'あ'.repeat(167), '髪型']);
  h.store.set('translatedTitlesEnabled', false);
  h.worker.scan();
  assert.equal(h.worker.running, null);
  h.write('0', { ...h.read('0'), downloadStatus: 'pending' });
  h.store.set('translatedTitlesEnabled', true);
  h.worker.scan();
  await h.worker.running;
  assert.deepEqual(h.calls, ['髪型']);
  assert.equal(h.read('1').titleTranslation.status, 'too-long');
});

test('errors pause all requests and survive restart, then retry after a day', async t => {
  let time = 1000, requests = 0;
  const h = setup(t, ['衣装', '髪型'], { now: () => time, translate: async () => { requests++; throw new Error('HTTP 429'); } });
  h.worker.scan();
  await h.worker.running;
  assert.equal(requests, 1);
  const restarted = new TitleTranslations(h.config);
  restarted.scan();
  await restarted.running;
  assert.equal(requests, 1);
  time += 24 * 60 * 60 * 1000;
  restarted.scan();
  await restarted.running;
  assert.equal(requests, 2);
});

test('local daily budget prevents excess requests', async t => {
  const h = setup(t, ['衣装'], { now: () => 1000 });
  h.store.set('titleTranslationsBudget', { start: 1000, used: 4999 });
  h.worker.scan();
  await h.worker.running;
  assert.equal(h.calls.length, 0);
});

test('changed Japanese titles get a new translation, but repeated saves do not', async t => {
  const h = setup(t, ['衣装']);
  h.worker.scan();
  await h.worker.running;
  h.write('0', { ...h.read('0'), name: '髪型' });
  h.worker.enqueue(h.root, '0');
  h.worker.enqueue(h.root, '0');
  await h.worker.running;
  assert.deepEqual(h.calls, ['衣装', '髪型']);
  assert.equal(h.read('0').titleTranslation.source, '髪型');
});

test('disabling during a request stops the remaining queue', async t => {
  let release;
  const calls = [];
  const h = setup(t, ['衣装', '髪型'], { translate: source => {
    calls.push(source);
    return new Promise(resolve => { release = resolve; });
  } });
  h.worker.scan();
  await new Promise(resolve => setImmediate(resolve));
  h.store.set('translatedTitlesEnabled', false);
  release('Outfit');
  await h.worker.running;
  assert.deepEqual(calls, ['衣装']);
  assert.equal(h.read('0').titleTranslation.text, 'Outfit');
});

test('root changes during a request do not write its result into the old library', async t => {
  let release;
  const h = setup(t, ['衣装'], { translate: () => new Promise(resolve => { release = resolve; }) });
  h.worker.scan();
  await new Promise(resolve => setImmediate(resolve));
  h.store.set('rootFolder', path.join(h.root, 'other'));
  release('Outfit');
  await h.worker.running;
  assert.equal(h.read('0').titleTranslation.status, 'pending');
});

test('cooldown stops scans immediately and reports a persistent paused status', async t => {
  let time = 1000, scans = 0;
  const statuses = [];
  const h = setup(t, ['衣装', '髪型'], { now: () => time, onStatus: s => statuses.push(s), translate: async () => { throw new Error('HTTP 429'); } });
  const original = h.config.assets.getAssets;
  h.config.assets.getAssets = () => { scans++; return original(); };
  h.worker.scan();
  await h.worker.running;
  assert.equal(h.worker.queue.size, 0);
  assert.equal(statuses.at(-1).state, 'paused');
  assert.ok(statuses.at(-1).retryAt >= time + 8 * 60 * 60 * 1000);
  time += 7 * 60 * 60 * 1000;
  h.worker.scan();
  assert.equal(scans, 1);
  assert.equal(h.worker.queue.size, 0);
});

test('real worker reuses saved translations and commits without a full index write', async t => {
  const { TitleTranslationThread } = require('../src/titleTranslationThread');
  const { createHash } = require('crypto');
  const h = setup(t, ['衣装']);
  const hash = createHash('sha256').update('衣装').digest('hex');
  h.store.set('titleTranslationsCache', { [hash]: { status: 'complete', text: 'Outfit' } });
  let done, fail;
  const completed = new Promise((resolve, reject) => { done = resolve; fail = reject; });
  const timeout = setTimeout(() => fail(new Error('Worker timed out')), 5000);
  t.after(() => clearTimeout(timeout));
  const touched = [];
  const thread = new TitleTranslationThread({
    store: h.store, statePath: path.join(h.root, 'translation-state.json'),
    assets: { touchIndexEntry: (...args) => touched.push(args) },
    onStatus: status => { if (status.state === 'error') fail(new Error('Worker failed')); },
    onSaved: done,
  });
  t.after(() => thread.stop());
  thread.configure();
  const saved = await completed;
  assert.equal(saved.titleTranslation.text, 'Outfit');
  assert.equal(h.read('0').titleTranslation.text, 'Outfit');
  assert.deepEqual(touched[0][3], { translationOnly: true });
});
