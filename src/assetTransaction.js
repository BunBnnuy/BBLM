'use strict';

const fs = require('fs');
const path = require('path');
const { createStagingDirectory, removeTree } = require('./atomicFs');

class AssetTransaction {
  constructor(root, options = {}) {
    this.root = root;
    this.staging = createStagingDirectory(root, options.id);
    this.committed = false;
    this.createdSource = false;
  }

  stagePath(relativePath) {
    if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) throw new Error('Invalid staging path');
    const resolved = path.resolve(this.staging, relativePath);
    const rel = path.relative(this.staging, resolved);
    if (rel.startsWith('..' + path.sep) || rel === '..') throw new Error('Staging path escapes transaction');
    return resolved;
  }

  copyFile(source, relativePath) {
    const destination = this.stagePath(relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    return destination;
  }

  writeFile(relativePath, data, options) {
    const destination = this.stagePath(relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, data, { ...options, flag: 'wx' });
    return destination;
  }

  commit(assetId) {
    if (this.committed) throw new Error('Transaction already committed');
    if (typeof assetId !== 'string' || !/^[A-Za-z0-9._-]{1,120}$/.test(assetId)) throw new Error('Invalid asset id');
    const destination = path.join(this.root, assetId);
    if (fs.existsSync(destination)) throw new Error('Asset already exists');
    fs.renameSync(this.staging, destination);
    this.committed = true;
    return destination;
  }

  rollback() {
    if (!this.committed) removeTree(this.staging);
  }
}

module.exports = { AssetTransaction };
