const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const { writeJsonAtomic } = require('./atomicFs');
const { resolveExistingAssetDir } = require('./security/pathPolicy');

class TitleTranslationThread {
  constructor({ store, assets, statePath, onStatus, onSaved }) {
    Object.assign(this, { store, assets, statePath, onStatus, onSaved });
    this.status = { state: 'idle' };
    this.worker = null;
  }
  setStatus(status) { this.status = status; this.onStatus(status); }
  configure() {
    const config = { rootFolder: this.store.get('rootFolder', ''), translatedTitlesEnabled: this.store.get('translatedTitlesEnabled', false) };
    if (this.worker) { this.worker.postMessage({ type: 'configure', config }); return; }
    if (!config.translatedTitlesEnabled) return;
    this.worker = new Worker(path.join(__dirname, 'titleTranslationWorker.js'), { workerData: {
      config, statePath: this.statePath,
      initialState: {
        titleTranslationsBudget: this.store.get('titleTranslationsBudget', {}),
        titleTranslationsCache: this.store.get('titleTranslationsCache', {}),
      },
    } });
    this.worker.on('message', message => {
      if (message.type === 'status') this.setStatus(message.status);
      if (message.type === 'commit') {
        let error;
        try { this.commit(message); } catch (err) { error = err.message; }
        this.worker?.postMessage({ type: 'commit-result', requestId: message.requestId, error });
      }
    });
    this.worker.on('error', () => this.setStatus({ state: 'error' }));
    this.worker.on('exit', () => { this.worker = null; });
    this.worker.unref();
  }
  enqueue(root, id) {
    if (this.store.get('translatedTitlesEnabled', false)) this.worker?.postMessage({ type: 'enqueue', root, id });
  }
  commit({ root, id, source, state }) {
    if (root !== this.store.get('rootFolder', '')) return;
    const metaPath = path.join(resolveExistingAssetDir(root, id), 'meta.json');
    const latest = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (latest.name !== source) return;
    latest.titleTranslation = { source, ...state };
    writeJsonAtomic(metaPath, latest);
    this.assets.touchIndexEntry(this.store, id, latest, { translationOnly: true });
    if (state.status === 'complete') this.onSaved(latest);
  }
  stop() { return this.worker?.terminate(); }
}
module.exports = { TitleTranslationThread };
