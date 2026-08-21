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
const { parseScanOutput } = require('../src/malwareScanWorker');
const { parseReleaseNotes } = require('../src/releaseNotes');

test('release notes parser returns the current changelog version only', () => {
  const notes = parseReleaseNotes('# Changelog\n\n## [2.0.0] - today\n\n### Added\n\n- **New feature**\n\n### Fixed\n\n- Fixed a bug\n\n## [1.0.0]\n\n- Old change', '2.0.0');
  assert.equal(notes.version, '2.0.0');
  assert.deepEqual(notes.sections, [
    { title: 'Added', items: ['**New feature**'] },
    { title: 'Fixed', items: ['Fixed a bug'] },
  ]);
});

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

test('archive listing skips the archive-level header block from 7z -slt output', () => {
  // `7z l -slt` prints one block for the archive itself (an absolute path,
  // which would otherwise trip invalidEntry) before a line of dashes and the
  // real per-file blocks — this is real captured output from 7-Zip 26.02.
  const raw = [
    '--',
    'Path = D:\\BoothLM2\\km-lugia\\KabalMystic Lugia.zip',
    'Type = zip',
    'Physical Size = 5397689',
    '',
    '----------',
    'Path = KabalMystic Lugia.unitypackage',
    'Folder = -',
    'Size = 5408542',
    'Packed Size = 5397495',
    'Encrypted = -',
    '',
  ].join('\r\n');
  const entries = parseListing(raw, { maxEntries: 100, maxEntryBytes: 10 * 1024 * 1024, maxArchiveBytes: 100 * 1024 * 1024 });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].Path, 'KabalMystic Lugia.unitypackage');
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

test('malware scan output parses past the CLI banner and surfaces risk + findings', () => {
  const stdout = [
    '\u2554\u2550\u2550\u2550\u2557',
    '  vrcstorage-scanner v0.9.0',
    '\u255a\u2550\u2550\u2550\u255d',
    '',
    JSON.stringify({
      schema_version: '1.0',
      scanner: 'vrcstorage-scanner',
      file: { path: 'C:\\lib\\thing.unitypackage' },
      risk: { score: 19536, level: 'CRITICAL', recommendation: 'AutoReject' },
      findings: [
        { id: 'CS_ASSEMBLY_LOAD_BYTES', severity: 'Critical', points: 60, location: 'Assets/A.cs', detail: 'Assembly.Load/LoadFile detected' },
        { id: 'DLL_OUTSIDE_PLUGINS', severity: 'Medium', points: 35, location: 'Assets/B.dll', detail: 'DLL found outside Assets/Plugins/' },
      ],
    }),
  ].join('\n');

  const result = parseScanOutput(stdout, 2);
  assert.equal(result.severity, 'critical');
  assert.equal(result.score, 19536);
  assert.equal(result.recommendation, 'AutoReject');
  assert.equal(result.findings.length, 2);
  assert.equal(result.findings[0].detail, 'Assembly.Load/LoadFile detected');
  // "Copy Output" should get clean JSON, not the banner text.
  assert.doesNotMatch(result.raw, /vrcstorage-scanner v0\.9\.0/);
  assert.deepEqual(JSON.parse(result.raw).risk, { score: 19536, level: 'CRITICAL', recommendation: 'AutoReject' });
});
