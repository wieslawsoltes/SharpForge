import { GitError, checkLimit } from './errors.js';

const invisible = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const devices = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu;

/** Validate a portable repository-relative path before touching a worktree. */
export function validateCheckoutPath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\')) {
    throw new GitError('Unsafe', 'Repository path must be relative and use forward slashes', { path });
  }
  checkLimit(path.length, 32768, 'Repository path length');
  const components = path.split('/');
  checkLimit(components.length, 512, 'Repository path depth');
  for (const component of components) {
    const folded = component.normalize('NFKC').toLowerCase();
    const reserved = folded === '.git' || /^\.?git~[1-9][0-9]*$/u.test(folded);
    if (!component || component === '.' || component === '..' || reserved || invisible.test(component)
      || /[:*?"<>|]/u.test(component) || /[. ]$/u.test(component) || devices.test(folded)) {
      throw new GitError('Unsafe', 'Unsafe repository path component', { path, component });
    }
  }
  return path;
}

/** Refuse file/directory and case-fold collisions before any checkout writes. */
export function validateCheckoutPaths(paths, { caseSensitive = true } = {}) {
  const seen = new Map();
  const directories = new Set();
  for (const path of paths) {
    validateCheckoutPath(path);
    const key = caseSensitive ? path : path.normalize('NFC').toLowerCase();
    if (seen.has(key) || directories.has(key)) {
      throw new GitError('Unsafe', 'Checkout contains conflicting paths', { path, other: seen.get(key) });
    }
    const components = key.split('/');
    let prefix = '';
    for (const component of components.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${component}` : component;
      if (seen.has(prefix)) throw new GitError('Unsafe', 'Checkout crosses a file or symlink', { path });
      directories.add(prefix);
    }
    seen.set(key, path);
  }
}

/** Validate a stored link target; links may stay inside but never escape the root. */
export function validateSymlinkTarget(path, target) {
  validateCheckoutPath(path);
  if (typeof target !== 'string' || target.startsWith('/') || /[\\:\u0000]/u.test(target)) {
    throw new GitError('Unsafe', 'Symlink target escapes the repository', { path });
  }
  const components = path.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!components.length) throw new GitError('Unsafe', 'Symlink target escapes the repository', { path });
      components.pop();
    } else components.push(part);
  }
  if (components.length) validateCheckoutPath(components.join('/'));
  return target;
}
