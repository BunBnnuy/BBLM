'use strict';

// Reads the desktop (Electron) store so web mode shows the same library.
// The desktop app uses electron-store with default name "config", saved as
// config.json inside Electron's userData folder. This file is plain JSON,
// so plain Node can read it without Electron. Reads are cached by mtime.

const fs = require('fs');
const path = require('path');

const APP_DIR = 'bbs-libman';
const CONFIG_FILE = 'config.json';

function defaultUserDataDir() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, APP_DIR);
  }
  if (process.platform === 'darwin' && process.env.HOME) {
    return path.join(process.env.HOME, 'Library', 'Application Support', APP_DIR);
  }
  const base = process.env.XDG_CONFIG_HOME || (process.env.HOME ? path.join(process.env.HOME, '.config') : null);
  return base ? path.join(base, APP_DIR) : null;
}

function resolveDesktopConfigPath(explicit) {
  if (explicit) return explicit;
  if (process.env.BBLM_DESKTOP_CONFIG) return process.env.BBLM_DESKTOP_CONFIG;
  const dir = defaultUserDataDir();
  return dir ? path.join(dir, CONFIG_FILE) : null;
}

// Read-only view of the desktop config file. Never writes.
class DesktopStore {
  constructor(explicitPath) {
    this.path = resolveDesktopConfigPath(explicitPath);
    this.data = {};
    this.found = false;
    this.mtimeMs = 0;
    this.refresh();
  }

  refresh() {
    if (!this.path) { this.found = false; return false; }
    let stat = null;
    try { stat = fs.statSync(this.path); } catch { this.found = false; return false; }
    if (this.found && stat.mtimeMs === this.mtimeMs) return false;
    try {
      this.data = JSON.parse(fs.readFileSync(this.path, 'utf8'));
      this.found = true;
      this.mtimeMs = stat.mtimeMs;
      return true;
    } catch {
      this.found = false;
      return false;
    }
  }

  get(key, def) {
    this.refresh();
    if (!this.found) return def;
    const value = this.data[key];
    return value === undefined ? def : value;
  }
}

module.exports = { resolveDesktopConfigPath, DesktopStore };
