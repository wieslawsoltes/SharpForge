import { loadError, LoadErrorCode } from './load-errors.js';

/** Validate archive/deps paths before combining them with a host-selected root. */
export function relativeAssetPath(path) {
  if (typeof path !== 'string' || !path || path.length > 4096 || path.includes('\0') || path.includes('\\') ||
      path.startsWith('/') || /^[a-z]+:/i.test(path) || path.split('/').some(part => part === '..' || part === '.' || !part)) {
    throw loadError(LoadErrorCode.InvalidConfiguration, 'Unsafe assembly asset path');
  }
  return path;
}

export function combineAssetPath(root, path) {
  relativeAssetPath(path);
  if (typeof root !== 'string' || root.includes('\0')) throw new TypeError('A host-selected root is required');
  return root ? root.replace(/\/$/, '') + '/' + path : path;
}

/** RID graph expansion preserves declared fallback order and rejects cycles and excessive work. */
export function runtimeFallbacks(rid, graph = {}, { maxRids = 1024 } = {}) {
  if (typeof rid !== 'string' || !rid) return [];
  if (!Number.isSafeInteger(maxRids) || maxRids < 1 || maxRids > 4096) throw new RangeError('Invalid RID traversal limit');
  const result = [];
  const seen = new Set();
  const active = new Set();
  const stack = [{ rid, exit: false }];
  while (stack.length) {
    const current = stack.pop();
    if (current.exit) { active.delete(current.rid); continue; }
    if (active.has(current.rid)) throw loadError(LoadErrorCode.InvalidConfiguration, 'Cyclic RID fallback graph');
    if (seen.has(current.rid)) continue;
    if (seen.size === maxRids) throw loadError(LoadErrorCode.LimitExceeded, 'RID fallback limit exceeded');
    if (typeof current.rid !== 'string' || !current.rid) throw loadError(LoadErrorCode.InvalidConfiguration, 'Invalid RID');
    seen.add(current.rid);
    active.add(current.rid);
    result.push(current.rid);
    const entry = Object.hasOwn(graph, current.rid) ? graph[current.rid] : [];
    const imports = Array.isArray(entry) ? entry : entry?.['#import'] ?? [];
    if (!Array.isArray(imports)) throw loadError(LoadErrorCode.InvalidConfiguration, 'Invalid RID imports');
    if (imports.length + stack.length > maxRids * 2) throw loadError(LoadErrorCode.LimitExceeded, 'RID edge limit exceeded');
    stack.push({ rid: current.rid, exit: true });
    for (let index = imports.length - 1; index >= 0; index--) stack.push({ rid: imports[index], exit: false });
  }
  return result;
}
