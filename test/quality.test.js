'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { writeJsonAtomic, cleanupStaging } = require('../src/atomicFs');
const { AssetTransaction } = require('../src/assetTransaction');
const { parseListing, invalidEntry } = require('../src/scannerWorker');
const { redactUrl, sanitize } = require('../src/logger');
const { parseDownloadProtocol, parseImportIntent } = require('../src/protocol');

test('atomic JSON replacement leaves valid complete JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bblm-test-'));
  const file = path.join(root, 'meta.json');
  writeJsonAtomic(file, { name: 'safe', count: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { name: 'safe', count: 2 });
  fs.rmSync(root, { recursive: true, force: true });
});

test('asset transaction rolls back and rejects traversal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bblm-test-'));
  const tx = new AssetTransaction(root);
  assert.throws(() => tx.stagePath('../outside'));
  tx.rollback();
  assert.equal(fs.readdirSync(root).length, 1); // staging root remains for future transactions
  fs.rmSync(root, { recursive: true, force: true });
});

test('archive listing rejects traversal and oversized entries', () => {
  assert.equal(invalidEntry('../x'), true);
  assert.throws(() => parseListing('Path = x\nSize = 999\n\n', { maxEntries: 5, maxEntryBytes: 10, maxArchiveBytes: 10 }));
});

test('logger removes credentials, query values and control characters', () => {
  const redacted = redactUrl('https://user:pass@example.com/download?token=secret#x');
  assert.match(redacted, /redacted/);
  assert.doesNotMatch(redacted, /pass|secret/);
  assert.equal(sanitize('C:\\Users\\Alice\\private.txt'), 'private.txt');
  assert.equal(sanitize('a\u0000b'), 'ab');
});

test('stale staging cleanup is bounded to staging children', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bblm-test-'));
  const staging = path.join(root, '.bblm-staging', 'old');
  fs.mkdirSync(staging, { recursive: true });
  fs.utimesSync(staging, new Date(0), new Date(0));
  assert.equal(cleanupStaging(root, 1), 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('protocol parsers reject unsafe downloads and preserve import intent', () => {
  assert.throws(() => parseDownloadProtocol('bunslm://download?dlurl=http%3A%2F%2F127.0.0.1%2Fx&downloadable_filename=x.zip'));
  const intent = parseImportIntent('bunslm://import?origin_url=https%3A%2F%2Fbooth.pm%2Fen%2Fitems%2F1&filename=item.zip');
  assert.equal(intent.filename, 'item.zip');
  assert.equal(intent.originUrl, 'https://booth.pm/en/items/1');
});
