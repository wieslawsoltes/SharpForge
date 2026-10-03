import { GitError } from '../errors.js';

/** Apply git check-ref-format rules. One-level pseudorefs require explicit permission. */
export function isValidRefName(name, { allowOneLevel = false, refspecPattern = false, branch = false } = {}) {
  if (typeof name !== 'string' || !name || name === '@' || name.startsWith('/') || name.endsWith('/')) return false;
  if (branch && name.startsWith('-')) return false;
  if (name.endsWith('.') || name.includes('..') || name.includes('@{') || /[\x00-\x20\x7f~^:?\[\\]/u.test(name)) return false;
  const wildcards = name.split('*').length - 1;
  if (wildcards > (refspecPattern ? 1 : 0)) return false;
  const parts = name.split('/');
  if (!allowOneLevel && parts.length < 2) return false;
  return parts.every(part => part && !part.startsWith('.') && !part.endsWith('.lock'));
}

export function validateRefName(name, options = {}) {
  if (!isValidRefName(name, options)) throw new GitError('Unsafe', 'Invalid Git reference name', { name });
  return name;
}

export function validateDatabaseRef(name) {
  const pseudoref = typeof name === 'string' && /^[A-Z][A-Z_]*$/u.test(name);
  validateRefName(name, { allowOneLevel: pseudoref });
  if (!pseudoref && !name.startsWith('refs/')) throw new GitError('Unsafe', 'Reference must be inside refs/', { name });
  return name;
}
