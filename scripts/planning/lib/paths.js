import { posix } from 'node:path';
export function safePath(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..') || path.includes('\0')) throw new Error(`Unsafe repository path: ${path}`);
  return posix.normalize(path).replace(/^\.\//, '');
}
export function globPattern(glob) {
  glob = safePath(glob); let pattern = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++; if (glob[i + 1] === '/') { pattern += '(?:.*/)?'; i++; } else pattern += '.*';
    } else if (c === '*') pattern += '[^/]*';
    else if (c === '?') pattern += '[^/]';
    else pattern += c.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(pattern + '$');
}
export const matches = (path, globs) => globs.some(glob => globPattern(glob).test(safePath(path)));
export function overlaps(a, b) {
  a = safePath(a); b = safePath(b);
  if (a.endsWith('/')) a += '**'; if (b.endsWith('/')) b += '**';
  if (!/[?*]/.test(a)) return matches(a, [b]);
  if (!/[?*]/.test(b)) return matches(b, [a]);
  const ap = a.split(/[?*]/)[0], bp = b.split(/[?*]/)[0];
  return ap.startsWith(bp) || bp.startsWith(ap);
}
