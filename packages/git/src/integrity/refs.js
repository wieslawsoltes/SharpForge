import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { validateObjectId } from '../object-format.js';
import { parsePackedRefs } from '../refs/packed.js';
import { parseReflog } from '../refs/reflog.js';
import { decodeIndex } from '../index-file.js';
import { IntegrityCategory as Category } from './report.js';

const decoder = new TextDecoder('utf-8', { fatal: true });

async function referenceNames(repository, report, options) {
  const names = new Set(['HEAD']);
  try {
    for (const ref of await repository.refs.list('refs/', options)) names.add(ref.name);
  } catch (error) {
    report.capture(normalizeReferenceError(error), Category.BadRef);
    if (!repository.store?.list) return [...names];
    for (const key of await repository.store.list('refs/', options)) if (!key.endsWith('.lock')) names.add(key);
    const bytes = await repository.store.get('packed-refs', options);
    if (bytes) {
      try {
        for (const ref of parsePackedRefs(decoder.decode(bytes), { algorithm: repository.algorithm })) names.add(ref.name);
      } catch (failure) {
        if (failure instanceof TypeError) report.add(Category.BadRef, 'Packed refs contain invalid UTF-8');
        else report.capture(failure, Category.BadRef, { ref: 'packed-refs' });
      }
    }
  }
  checkLimit(names.size, options.maxRefs ?? 1_000_000, 'Integrity reference count');
  return [...names].sort();
}

/** References, reflogs and the index are independent reachability roots, as in git fsck. */
export async function integrityRoots(repository, report, options) {
  const roots = [];
  const names = await referenceNames(repository, report, options);
  for (const name of names) {
    checkCancelled(options.signal);
    try {
      const resolved = await repository.refs.resolve(name, options);
      if (!resolved.oid) {
        if (name !== 'HEAD') report.add(Category.BadRef, 'Reference resolves to a missing target', { ref: name });
        continue;
      }
      const oid = validateObjectId(resolved.oid, repository.algorithm, { allowZero: false });
      const type = name === 'HEAD' || name.startsWith('refs/heads/') || name.startsWith('refs/remotes/') ? 'commit' : null;
      roots.push({ oid, type, ref: name });
    } catch (error) {
      report.capture(normalizeReferenceError(error), Category.BadRef, { ref: name });
    }
  }
  if (options.reflogs !== false) await reflogRoots(repository, roots, report, options);
  if (options.index !== false) await indexRoots(repository, roots, report, options);
  for (const oid of options.roots ?? []) roots.push({ oid: validateObjectId(oid, repository.algorithm, { allowZero: false }), type: null });
  checkLimit(roots.length, options.maxRoots ?? 4_000_000, 'Integrity root count');
  return roots;
}

async function reflogRoots(repository, roots, report, options) {
  if (!repository.store?.list) return;
  for (const key of await repository.store.list('logs/', options)) {
    checkCancelled(options.signal);
    try {
      const bytes = await repository.store.get(key, options);
      const entries = parseReflog(decoder.decode(bytes), { algorithm: repository.algorithm });
      for (const entry of entries) {
        for (const oid of [entry.oldOid, entry.newOid]) {
          if (oid && /[^0]/.test(oid)) roots.push({ oid, type: null, ref: key });
        }
      }
      checkLimit(roots.length, options.maxRoots ?? 4_000_000, 'Integrity root count');
    } catch (error) {
      if (error instanceof TypeError) report.add(Category.BadRef, 'Reflog contains invalid UTF-8', { ref: key });
      else report.capture(error, Category.BadRef, { ref: key });
    }
  }
}

async function indexRoots(repository, roots, report, options) {
  if (!repository.store?.get) return;
  const bytes = await repository.store.get('index', options);
  if (!bytes) return;
  try {
    const index = await decodeIndex(bytes, { algorithm: repository.algorithm, maxEntries: options.maxObjects ?? 1_000_000 });
    for (const entry of index.entries) {
      if (entry.mode === 0o160000 || entry.intentToAdd || !/[^0]/.test(entry.oid)) continue;
      roots.push({ oid: entry.oid, type: entry.mode === 0o40000 ? 'tree' : 'blob', ref: 'index', path: entry.path });
    }
  } catch (error) {
    report.capture(error, Category.BadIndex, { ref: 'index' });
  }
}

/** A malformed UTF-8 reference is data corruption, not a native TypeError escaping the verifier. */
export function normalizeReferenceError(error) {
  return error instanceof TypeError ? new GitError('Corrupt', 'Invalid reference encoding') : error;
}
