const fs = require('fs');
const path = require('path');

const RESERVED = /^(con|prn|aux|nul|clock\$|com[0-9]|lpt[0-9])(?:\..*)?$/i;
const INTERNAL = new Set(['.bblm-staging', '_temp_downloads']);

function validateAssetId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 120 || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error('Invalid asset id');
  }
  if (value === '.' || value === '..' || RESERVED.test(value) || /[. ]$/.test(value)) throw new Error('Invalid asset id');
  return value;
}

function sanitizeExternalFilename(value, extensions) {
  if (typeof value !== 'string' || !value || value.length > 180 || /[\\/\0\x00-\x1f\x7f<>"|?*]/.test(value) || /[:]/.test(value) || /[. ]$/.test(value)) throw new Error('Invalid filename');
  if (path.isAbsolute(value) || value === '.' || value === '..' || RESERVED.test(value)) throw new Error('Invalid filename');
  if (extensions && !extensions.some(e => value.toLowerCase().endsWith(e.toLowerCase()))) throw new Error('Unsupported filename extension');
  return value;
}

function realRoot(root) {
  if (typeof root !== 'string' || !root) throw new Error('Root folder is not configured');
  return fs.realpathSync(root);
}

function resolveInsideRoot(root, ...segments) {
  const base = realRoot(root);
  const candidate = path.resolve(base, ...segments);
  const rel = path.relative(base, candidate);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Path is outside root');
  // Existing targets must resolve inside the real root, preventing symlink/junction escapes.
  if (fs.existsSync(candidate)) {
    const real = fs.realpathSync(candidate);
    const rr = path.relative(base, real);
    if (rr === '..' || rr.startsWith(`..${path.sep}`) || path.isAbsolute(rr)) throw new Error('Path resolves outside root');
  } else {
    // Walk up to the nearest existing parent. New import directories do not
    // exist yet, but an existing junction in their ancestry must still fail.
    let parent = path.dirname(candidate);
    while (!fs.existsSync(parent)) {
      const next = path.dirname(parent);
      if (next === parent) throw new Error('Invalid path parent');
      parent = next;
    }
    const realParent = fs.realpathSync(parent);
    const pr = path.relative(base, realParent);
    if (pr === '..' || pr.startsWith(`..${path.sep}`) || path.isAbsolute(pr)) throw new Error('Parent resolves outside root');
  }
  return candidate;
}

function resolveExistingAssetDir(root, assetId) {
  validateAssetId(assetId);
  const dir = resolveInsideRoot(root, assetId);
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Invalid asset directory');
  return dir;
}

function resolveAssetFile(root, assetId, relativeName) {
  validateAssetId(assetId);
  if (typeof relativeName !== 'string' || path.basename(relativeName) !== relativeName || relativeName.includes('/') || relativeName.includes('\\')) throw new Error('Invalid asset filename');
  return resolveInsideRoot(root, assetId, sanitizeExternalFilename(relativeName));
}

function allocateAssetId(root, candidate) {
  const base = validateAssetId(candidate);
  let id = base; let n = 2;
  while (INTERNAL.has(id) || fs.existsSync(path.join(realRoot(root), id))) id = `${base}-${n++}`;
  return validateAssetId(id);
}

module.exports = { validateAssetId, sanitizeExternalFilename, resolveInsideRoot, resolveExistingAssetDir, resolveAssetFile, allocateAssetId, INTERNAL };
