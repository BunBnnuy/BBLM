'use strict';

const path = require('path');

const debugEnabled = process.env.BBLM_DEBUG === '1';
const SENSITIVE_KEYS = /^(token|access_token|refresh_token|client_secret|password|authorization|cookie|session|code|state)$/i;

function redactUrl(value) {
  try {
    const url = new URL(String(value));
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[redacted]');
    url.hash = '';
    return url.toString().replace(/[\u0000-\u001f\u007f]/g, '');
  } catch { return '[invalid-url]'; }
}

function sanitize(value, key = '') {
  if (SENSITIVE_KEYS.test(key)) return '[redacted]';
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) return redactUrl(value);
    if (/^[A-Za-z]:[\\/]/.test(value) || value.includes('\\')) return path.basename(value);
    return value.replace(/[\u0000-\u001f\u007f]/g, '');
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitize(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 50)) out[k] = sanitize(v, k);
    return out;
  }
  return value;
}

function emit(level, event, details) {
  const record = { event: String(event).slice(0, 100), ...(details ? sanitize(details) : {}) };
  const line = `[${level}] ${JSON.stringify(record)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (debugEnabled) console.log(line);
}

module.exports = {
  debug: (event, details) => emit('debug', event, details),
  info: (event, details) => emit('info', event, details),
  warn: (event, details) => emit('warn', event, details),
  error: (event, details) => emit('error', event, details),
  sanitize,
  redactUrl,
};
