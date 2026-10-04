const reservedName = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;

/** Portable, root-relative path validation. The spelling is preserved; identity is a separate policy. */
export function portablePath(value, {directory = false, maxPathLength = 1024, maxDepth = 48} = {}) {
  if (!Number.isSafeInteger(maxPathLength) || maxPathLength < 1 || !Number.isSafeInteger(maxDepth) || maxDepth < 1) {
    throw new RangeError('Invalid portable path limits');
  }
  if (typeof value !== 'string' || !value || value.length > maxPathLength || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Unsafe archive path: ' + String(value).slice(0, 120));
  }
  if (/^[\\/]|^[a-zA-Z]:/.test(value)) throw new Error('Absolute paths are outside the granted workspace');
  let path = value.replaceAll('\\', '/');
  if (directory && path.endsWith('/')) path = path.slice(0, -1);
  const parts = path.split('/');
  if (parts.length > maxDepth || parts.some(invalidPart)) {
    throw new Error('Non-portable or traversing archive path: ' + value);
  }
  return path;
}

function invalidPart(part) {
  return !part || part === '.' || part === '..' || /[<>:"|?*]/.test(part) || /[. ]$/.test(part) || reservedName.test(part);
}

/** Explicit filesystem identity; NFC identity never rewrites a persisted path's spelling. */
export class PathPolicy {
  constructor({caseSensitive = true, unicodeNormalization = 'NFC', maxPathLength = 1024, maxDepth = 48} = {}) {
    if (!['NFC', 'NFD', 'none'].includes(unicodeNormalization)) throw new TypeError('Unknown Unicode path policy');
    this.caseSensitive = !!caseSensitive;
    this.unicodeNormalization = unicodeNormalization;
    this.maxPathLength = maxPathLength;
    this.maxDepth = maxDepth;
    Object.freeze(this);
  }

  normalize(value, {allowRoot = false, directory = false} = {}) {
    if (allowRoot && (value === '' || value === '.')) return '';
    return portablePath(value, {...this, directory});
  }

  identity(value, options) {
    const path = this.normalize(value, options);
    const normalized = this.unicodeNormalization === 'none' ? path : path.normalize(this.unicodeNormalization);
    return this.caseSensitive ? normalized : normalized.toLowerCase();
  }

  equals(left, right) {
    return this.identity(left, {allowRoot: true}) === this.identity(right, {allowRoot: true});
  }

  contains(parent, child, {includeSelf = true} = {}) {
    const root = this.identity(parent, {allowRoot: true});
    const path = this.identity(child, {allowRoot: true});
    return (includeSelf && root === path) || (root === '' ? path !== '' : path.startsWith(root + '/'));
  }

  compare(left, right) {
    const a = this.identity(left, {allowRoot: true});
    const b = this.identity(right, {allowRoot: true});
    return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0;
  }
}

export const pathIdentity = (path, options) => new PathPolicy(options).identity(path, {allowRoot: true});
export const samePath = (left, right, options) => new PathPolicy(options).equals(left, right);
export const isWithinPath = (parent, child, options) => new PathPolicy(options).contains(parent, child);
export const comparePaths = (left, right, options) => new PathPolicy(options).compare(left, right);
