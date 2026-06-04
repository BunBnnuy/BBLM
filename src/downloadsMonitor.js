const fs = require('fs');
const path = require('path');

const WATCHED_EXTENSIONS = new Set([
  // Compressed
  'zip', 'rar', '7z', 'tar', 'gz',
  // Unity
  'unitypackage', 'uasset',
  // 3D formats
  'blend', 'fbx', 'obj', 'max', 'ma', 'mb',
  'stl', 'gltf', 'glb', 'usd', 'usda', 'usdc', 'abc', 'dae',
]);

const STABLE_CHECKS = 3;
const POLL_MS = 1500;

class DownloadsMonitor {
  constructor(onFileReady) {
    this.onFileReady = onFileReady;
    this.watcher = null;
    this.pending = new Map(); // filename → { size, count, timer }
    this.seen = new Set();
  }

  start(downloadsFolder) {
    if (this.watcher) this.stop();
    if (!fs.existsSync(downloadsFolder)) return;

    this.watcher = fs.watch(downloadsFolder, (eventType, filename) => {
      if (!filename) return;
      const ext = filename.split('.').pop().toLowerCase();
      if (!WATCHED_EXTENSIONS.has(ext)) return;

      const fullPath = path.join(downloadsFolder, filename);
      if (this.seen.has(fullPath)) return;

      this._trackFile(fullPath);
    });

    this.watcher.on('error', () => this.stop());
  }

  _trackFile(fullPath) {
    if (this.pending.has(fullPath)) return;

    const entry = { size: -1, count: 0 };
    this.pending.set(fullPath, entry);

    const poll = () => {
      if (!this.pending.has(fullPath)) return;

      if (!fs.existsSync(fullPath)) {
        // Temp/partial file vanished — might be renamed on completion
        entry.count = 0;
        entry.size = -1;
        entry.timer = setTimeout(poll, POLL_MS);
        return;
      }

      let size;
      try { size = fs.statSync(fullPath).size; } catch { size = -1; }

      if (size > 0 && size === entry.size) {
        entry.count++;
        if (entry.count >= STABLE_CHECKS) {
          this.pending.delete(fullPath);
          this.seen.add(fullPath);
          this.onFileReady(fullPath);
          return;
        }
      } else {
        entry.count = 0;
        entry.size = size;
      }

      entry.timer = setTimeout(poll, POLL_MS);
    };

    entry.timer = setTimeout(poll, POLL_MS);
  }

  stop() {
    if (this.watcher) { this.watcher.close(); this.watcher = null; }
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}

module.exports = { DownloadsMonitor };
