/** Root-relative logical path resolution for project references; escapes, URLs and controls are rejected. */
export function normalizePath(value, base = '') {
  if (typeof value !== 'string' || /[\u0000-\u001f]/.test(value)) throw new Error('Invalid workspace path');
  value = value.replaceAll('\\', '/');
  if (/^(?:\/|[A-Za-z]:|[a-z][a-z\d+.-]*:)/i.test(value)) {
    throw new Error('Absolute paths and URLs are outside the granted workspace');
  }
  const parts = [];
  for (const part of (base ? base + '/' : '').concat(value).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('Path escapes the granted workspace');
      parts.pop();
    } else parts.push(part);
  }
  if (!parts.length) throw new Error('Empty workspace path');
  return parts.join('/');
}

export const directoryName = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
export const baseName = path => path.slice(path.lastIndexOf('/') + 1);
