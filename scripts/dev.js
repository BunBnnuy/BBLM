'use strict';

// Dev launcher for `npm run dev`.
// - `npm run dev` starts Electron only. The app starts the web server only
//   when Settings > Remote Access is on.
// - `npm run dev -- --web` also runs the standalone web server.
// - `npm run dev -- --web-only` runs the standalone web server only.
// - `npm run dev -- --no-web` is accepted for old commands; it is the default.
// - `npm run dev -- --port 8090` sets the standalone web port. Env BBLM_PORT works too.
// - `--root`, `--host`, `--token`, `--config`, `--desktop-config` pass to server.js.

const { spawn } = require('node:child_process');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');
const SERVER_FLAGS = new Set(['--port', '--web-port', '--host', '--root', '--token', '--config', '--desktop-config']);

function parseArgs(argv) {
  const out = {
    port: Number(process.env.BBLM_PORT) || 47823,
    web: process.env.BBLM_WEB === '1',
    webOnly: false,
    serverArgs: [],
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-web' || arg === '--electron-only') out.web = false;
    else if (arg === '--web') out.web = true;
    else if (arg === '--web-only') { out.web = true; out.webOnly = true; }
    else if (SERVER_FLAGS.has(arg) && argv[i + 1]) {
      if (arg === '--port' || arg === '--web-port') out.port = Number(argv[i + 1]);
      out.serverArgs.push(arg === '--web-port' ? '--port' : arg, argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--port=')) {
      out.port = Number(arg.slice('--port='.length));
      out.serverArgs.push('--port', arg.slice('--port='.length));
    } else if (arg.startsWith('--host=')) out.serverArgs.push('--host', arg.slice('--host='.length));
    else if (arg.startsWith('--token=')) out.serverArgs.push('--token', arg.slice('--token='.length));
    else if (arg.startsWith('--root=')) out.serverArgs.push('--root', arg.slice('--root='.length));
  }
  if (!Number.isFinite(out.port) || out.port <= 0) out.port = 47823;
  if (!out.serverArgs.includes('--port')) out.serverArgs.push('--port', String(out.port));
  return out;
}

function start(name, command, args) {
  const child = spawn(command, args, { cwd: PROJECT_ROOT, stdio: 'inherit', shell: false });
  child.on('error', (err) => console.error(`[dev] ${name} failed to start:`, err.message));
  return child;
}

function main() {
  const opts = parseArgs(process.argv);
  const children = new Set();
  let stopping = false;

  const stopAll = (code) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      try { child.kill(); } catch { /* already gone */ }
    }
    if (code !== undefined) process.exit(code);
  };
  process.on('SIGINT', () => stopAll());
  process.on('SIGTERM', () => stopAll());

  if (opts.web) console.log(`[dev] standalone web UI runs at http://localhost:${opts.port}/`);

  if (opts.web) {
    const web = start('web', process.execPath, [path.join(PROJECT_ROOT, 'server.js'), ...opts.serverArgs]);
    children.add(web);
    web.on('exit', (code) => {
      children.delete(web);
      if (opts.webOnly) stopAll(code === null ? 0 : code);
      else console.error(`[dev] web server stopped (${code}). Electron keeps running.`);
    });
  }

  if (!opts.webOnly) {
    let electronPath = null;
    try {
      electronPath = require('electron');
    } catch {
      console.error('[dev] electron is not installed. Run `npm install` first.');
      stopAll(1);
      return;
    }
    const app = start('electron', electronPath, ['.', '--inspect=5858']);
    children.add(app);
    app.on('exit', (code) => {
      children.delete(app);
      stopAll(code === null ? 0 : code);
    });
  }
}

main();
