const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const { validateUrl } = require('./security/networkPolicy');

const DEFAULTS = { maxBytes: 5 * 1024 * 1024, timeoutMs: 30000, maxRedirects: 5 };
async function request(target, options = {}) {
  const cfg = { ...DEFAULTS, ...options }; let current = target;
  for (let redirects = 0; redirects <= cfg.maxRedirects; redirects++) {
    const checked = await validateUrl(current, cfg); const u = checked.url;
    const result = await new Promise((resolve, reject) => {
      const req = https.get(u, { headers: options.headers || {}, lookup: (host, opts, cb) => {
        const toEntry = a => ({ address: a, family: a.includes(':') ? 6 : 4 });
        if (opts && opts.all) return cb(null, checked.addresses.map(toEntry));
        const first = toEntry(checked.addresses[0]);
        cb(null, first.address, first.family);
      } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve({ redirect: new URL(res.headers.location, u).href }); }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        let total = 0; const chunks = [];
        res.on('data', c => { total += c.length; if (total > cfg.maxBytes) { req.destroy(); reject(new Error('Response exceeds size limit')); } else chunks.push(c); });
        res.on('end', () => resolve({ body: Buffer.concat(chunks), headers: res.headers }));
        res.on('error', reject);
      });
      req.setTimeout(cfg.timeoutMs, () => req.destroy(new Error('Request timed out'))); req.on('error', reject);
    });
    if (result.redirect) { current = result.redirect; continue; }
    if (cfg.destPath) { const tmp = `${cfg.destPath}.${process.pid}.${Date.now()}.part`; try { fs.mkdirSync(path.dirname(cfg.destPath), { recursive: true }); fs.writeFileSync(tmp, result.body, { flag: 'wx' }); fs.renameSync(tmp, cfg.destPath); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; } }
    return result;
  }
  throw new Error('Too many redirects');
}
async function fetchHtml(url, options = {}) { const r = await request(url, { ...options, maxBytes: options.maxBytes || 5 * 1024 * 1024 }); return r.body.toString('utf8'); }
async function download(url, destPath, options = {}) { await request(url, { ...options, destPath, maxBytes: options.maxBytes || 20 * 1024 * 1024 }); return destPath; }
module.exports = { request, fetchHtml, download };
