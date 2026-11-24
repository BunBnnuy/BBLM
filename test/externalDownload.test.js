'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyExternalUrl, pixeldrainInfoUrl, pixeldrainDownloadUrl } = require('../src/externalDownload');
const { parseExternalDownload } = require('../src/protocol');

test('classifies pixeldrain and workupload links', () => {
  assert.deepEqual(
    classifyExternalUrl('https://pixeldrain.com/u/abc123'),
    { host: 'pixeldrain', id: 'abc123' },
  );
  assert.deepEqual(
    classifyExternalUrl('https://pixeldrain.com/api/file/abc123'),
    { host: 'pixeldrain', id: 'abc123' },
  );
  assert.deepEqual(
    classifyExternalUrl('https://workupload.com/file/AbC123'),
    { host: 'workupload', id: 'AbC123' },
  );
  assert.deepEqual(
    classifyExternalUrl('https://workupload.com/archive/nmyT3xEBcs'),
    { host: 'workupload', id: 'nmyT3xEBcs' },
  );
  assert.deepEqual(
    classifyExternalUrl('https://forum.ripper.store/hidelinks/r/abc'),
    { host: 'hidelink', id: '' },
  );
  assert.equal(classifyExternalUrl('https://example.com/file/abc'), null);
  assert.equal(classifyExternalUrl('http://pixeldrain.com/u/abc'), null);
  assert.equal(classifyExternalUrl('https://pixeldrain.com/'), null);
});

test('builds pixeldrain file URLs', () => {
  assert.equal(pixeldrainInfoUrl('abc123'), 'https://pixeldrain.com/api/file/abc123/info');
  assert.equal(pixeldrainDownloadUrl('abc123'), 'https://pixeldrain.com/api/file/abc123?download');
});

test('external protocol parses a supported download', () => {
  const intent = parseExternalDownload(
    'bunslm://external?url=https%3A%2F%2Fpixeldrain.com%2Fu%2Fabc123'
    + '&origin_url=https%3A%2F%2Fbooth.pm%2Fen%2Fitems%2F1234567'
    + '&forum_url=https%3A%2F%2Fforum.ripper.store%2Ftopic%2F99',
  );
  assert.equal(intent.url, 'https://pixeldrain.com/u/abc123');
  assert.equal(intent.originUrl, 'https://booth.pm/en/items/1234567');
  assert.equal(intent.itemId, '1234567');
  assert.equal(intent.source, 'forum');
});

test('external protocol accepts workupload pages', () => {
  const intent = parseExternalDownload(
    'bunslm://external?url=https%3A%2F%2Fworkupload.com%2Ffile%2FAbC123',
  );
  assert.equal(intent.url, 'https://workupload.com/file/AbC123');
  assert.equal(intent.originUrl, '');
  assert.equal(intent.itemId, '');
});

test('external protocol accepts forum hidelinks', () => {
  const intent = parseExternalDownload(
    'bunslm://external?url=https%3A%2F%2Fforum.ripper.store%2Fhidelinks%2Fr%2Fabc'
    + '&origin_url=https%3A%2F%2Fbooth.pm%2Fen%2Fitems%2F1234567',
  );
  assert.equal(intent.url, 'https://forum.ripper.store/hidelinks/r/abc');
  assert.equal(intent.itemId, '1234567');
});

test('external protocol accepts a forum hidelink and archive password', () => {
  const intent = parseExternalDownload(
    'bunslm://external?url=https%3A%2F%2Fforum.ripper.store%2Fhidelinks%2Fr%2Fabc'
    + '&origin_url=https%3A%2F%2Fbooth.pm%2Fen%2Fitems%2F9055074'
    + '&password=hyun',
  );
  assert.equal(intent.url, 'https://forum.ripper.store/hidelinks/r/abc');
  assert.equal(intent.itemId, '9055074');
  assert.equal(intent.archivePassword, 'hyun');
});

test('external protocol rejects control characters in the password', () => {
  assert.throws(
    () => parseExternalDownload(
      'bunslm://external?url=https%3A%2F%2Fpixeldrain.com%2Fu%2Fabc&password=bad%00value',
    ),
    /Invalid archive password/,
  );
});

test('external protocol rejects unknown hosts and bad origins', () => {
  assert.throws(
    () => parseExternalDownload('bunslm://external?url=https%3A%2F%2Fexample.com%2Ffile.zip'),
    /Unsupported download host/,
  );
  assert.throws(
    () => parseExternalDownload(
      'bunslm://external?url=https%3A%2F%2Fpixeldrain.com%2Fu%2Fabc&origin_url=https%3A%2F%2Fexample.com',
    ),
    /Invalid origin host/,
  );
  assert.throws(
    () => parseExternalDownload('bunslm://external?url=https%3A%2F%2Fpixeldrain.com%2Fu%2Fabc&unknown=1'),
    /Unknown protocol parameter/,
  );
});
