const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const { TitleTranslations } = require('./titleTranslations');
const { scanDiskEntries, readIndexFile } = require('./assetIndex');
const { writeJsonAtomic } = require('./atomicFs');

// This file belongs only to the worker. Never open electron-store in two threads.
let state;
try { state = JSON.parse(fs.readFileSync(workerData.statePath, 'utf8')); }
catch { state = workerData.initialState || {}; }
let config = workerData.config;
const pending = new Map();
let sequence = 0;
const store = {
  get(key, fallback) {
    if (key === 'rootFolder' || key === 'translatedTitlesEnabled') return config[key];
    if (key.startsWith('titleTranslationsCache.')) return state.titleTranslationsCache?.[key.split('.')[1]] ?? fallback;
    return state[key] ?? fallback;
  },
  set(key, value) {
    if (key.startsWith('titleTranslationsCache.')) {
      state.titleTranslationsCache ||= {};
      state.titleTranslationsCache[key.split('.')[1]] = value;
    } else state[key] = value;
    writeJsonAtomic(workerData.statePath, state);
  },
};
let lastStatus = '';
const worker = new TitleTranslations({
  store,
  assets: { getAssets: () => {
    const root = config.rootFolder;
    if (!root || !fs.existsSync(root)) return [];
    // The 60-second eligibility scan only needs names and saved translations,
    // so read the shared index instead of every meta.json on disk.
    const index = readIndexFile(root);
    return index ? Object.values(index) : Object.values(scanDiskEntries(root));
  } },
  // Serialize small metadata commits with normal app saves to prevent lost edits.
  commit: payload => new Promise((resolve, reject) => {
    const requestId = ++sequence;
    pending.set(requestId, { resolve, reject });
    parentPort.postMessage({ type: 'commit', requestId, ...payload });
  }),
  onStatus: status => {
    const next = JSON.stringify(status);
    if (next !== lastStatus) { lastStatus = next; parentPort.postMessage({ type: 'status', status }); }
  },
});
function scan() {
  try { worker.scan(); } catch { parentPort.postMessage({ type: 'status', status: { state: 'error' } }); }
}
parentPort.on('message', message => {
  if (message.type === 'commit-result') {
    const request = pending.get(message.requestId);
    pending.delete(message.requestId);
    if (message.error) request?.reject(new Error(message.error));
    else request?.resolve();
  } else if (message.type === 'configure') {
    config = message.config;
    worker.queue.clear();
    if (!config.translatedTitlesEnabled) {
      lastStatus = '';
      parentPort.postMessage({ type: 'status', status: { state: 'idle' } });
    } else scan();
  } else if (message.type === 'enqueue') {
    worker.enqueue(message.root, message.id);
  }
});
scan();
// Cooldown checks are cheap; blocked scans never read the library or call the API.
setInterval(scan, 60000).unref();
