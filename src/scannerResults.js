'use strict';

const path = require('path');

function archiveKey(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return path.win32.resolve(value).toLowerCase();
}

function removeScannerResult(results, archivePath) {
  if (!Array.isArray(results)) return [];
  const target = archiveKey(archivePath);
  if (!target) return results;
  return results.filter(result => archiveKey(result?.archive) !== target);
}

module.exports = { removeScannerResult };
