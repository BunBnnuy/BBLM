'use strict';

// Owns the optional web library server inside the Electron main process.
// Off by default. Settings > Remote Access starts and stops it. Starting it
// in-process keeps it silent: there is no child window and no console output.

const os = require('os');
const logger = require('./logger');
const { startWebServer } = require('../server');

const DEFAULT_PORT = 47823;
const HOST = '0.0.0.0';

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return DEFAULT_PORT;
  return port;
}

function listUrls(port) {
  const urls = [`http://localhost:${port}/`];
  let interfaces = {};
  try { interfaces = os.networkInterfaces(); } catch { interfaces = {}; }
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      const ipv4 = entry.family === 'IPv4' || entry.family === 4;
      if (!ipv4 || entry.internal) continue;
      const url = `http://${entry.address}:${port}/`;
      if (!urls.includes(url)) urls.push(url);
    }
  }
  return urls;
}

class LibraryWebServer {
  constructor({ store, configPath, onDownloadRequest }) {
    this.store = store;
    this.configPath = configPath;
    this.onDownloadRequest = typeof onDownloadRequest === 'function' ? onDownloadRequest : null;
    this.instance = null;
    this.instanceToken = '';
    this.starting = null;
    this.error = '';
  }

  get enabled() {
    return this.store.get('webServerEnabled', false) === true;
  }

  get port() {
    return normalizePort(this.store.get('webServerPort', DEFAULT_PORT));
  }

  get token() {
    const value = this.store.get('webServerToken', '');
    return typeof value === 'string' ? value : '';
  }

  status() {
    const running = Boolean(this.instance);
    const port = running ? this.instance.getInfo().port : this.port;
    return {
      enabled: this.enabled,
      running,
      port,
      tokenConfigured: Boolean(this.token),
      urls: running ? listUrls(port) : [],
      error: this.error,
    };
  }

  async start() {
    if (this.instance) return this.status();
    if (this.starting) return this.starting;
    this.error = '';
    const port = this.port;
    const token = this.token;

    this.starting = (async () => {
      try {
        this.instance = await startWebServer({
          port,
          host: HOST,
          token,
          configPath: this.configPath,
          // Reads the live Electron store so library changes apply at once.
          desktopStore: { get: (key, def) => this.store.get(key, def) },
          desktopFound: true,
          onDownloadRequest: this.onDownloadRequest || undefined,
          log: (level, message) => logger[level === 'warn' ? 'warn' : 'info']('web-server', { message }),
        });
        this.instanceToken = token;
        logger.info('web-server-started', { port: this.instance.getInfo().port });
      } catch (error) {
        this.instance = null;
        if (error && error.code === 'EADDRINUSE') {
          this.error = `Port ${port} is already in use. Choose another port.`;
        } else if (error && error.code === 'EACCES') {
          this.error = `Port ${port} needs administrator rights. Choose a port above 1024.`;
        } else {
          this.error = error && error.message ? error.message : 'The web server could not start.';
        }
        logger.warn('web-server-start-failed', { message: this.error });
      } finally {
        this.starting = null;
      }
      return this.status();
    })();

    return this.starting;
  }

  async stop() {
    if (this.starting) await this.starting;
    if (!this.instance) return this.status();
    const instance = this.instance;
    this.instance = null;
    this.instanceToken = '';
    try { await instance.close(); } catch (error) { logger.warn('web-server-stop-failed', { message: error.message }); }
    logger.info('web-server-stopped');
    return this.status();
  }

  // Applies the current settings: start, stop, or restart with new values.
  async apply() {
    if (!this.enabled) {
      this.error = '';
      return this.stop();
    }
    if (this.instance) {
      const info = this.instance.getInfo();
      if (info.port === this.port && this.instanceToken === this.token) return this.status();
      await this.stop();
    }
    return this.start();
  }
}

module.exports = { LibraryWebServer, DEFAULT_PORT, normalizePort, listUrls };
