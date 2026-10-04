import { GitError, checkCancelled, checkLimit } from './errors.js';
import { collectReachable } from './remote-graph.js';
import { writePack } from './pack/writer.js';
import { writePackIndex } from './pack/index.js';
import { createPackReader } from './pack/accessor.js';
import { getObjectFormat, bytesToHex } from './object-format.js';
import { parseShallow } from './shallow.js';
import { encodeText, decodeText } from './protocol/bytes.js';

const AGE_LEDGER = 'sharpforge/gc-object-times';

async function maintenanceSnapshot(store, signal) {
  const keys = [...new Set(['HEAD', 'packed-refs', 'index', ...await store.list('refs/', { signal }),
    ...await store.list('logs/', { signal })])].sort();
  const refs = [];
  for (const key of keys) refs.push([key, await store.get(key, { signal })]);
  return { refs, packKeys: (await store.list('objects/pack/', { signal })).sort() };
}

function sameSnapshot(left, right) {
  if (left.refs.length !== right.refs.length || JSON.stringify(left.packKeys) !== JSON.stringify(right.packKeys)) return false;
  return left.refs.every(([key, bytes], index) => {
    const [otherKey, otherBytes] = right.refs[index];
    return key === otherKey && bytes?.length === otherBytes?.length && (!bytes || bytes.every((value, offset) => value === otherBytes[offset]));
  });
}

/** Report actual persisted bytes separately for loose objects, packs, indexes and other metadata. */
export async function repositoryStorageUsage({ odb, signal }) {
  const usage = { totalBytes: 0, looseBytes: 0, packBytes: 0, indexBytes: 0, metadataBytes: 0, looseObjects: 0, packs: 0 };
  for (const key of await odb.store.list('', { signal })) {
    checkCancelled(signal);
    const bytes = await odb.store.get(key, { signal });
    const size = bytes?.byteLength ?? 0;
    usage.totalBytes += size;
    if (/^objects\/[0-9a-f]{2}\/[0-9a-f]+$/.test(key)) { usage.looseBytes += size; usage.looseObjects++; }
    else if (/^objects\/pack\/pack-[0-9a-f]+\.pack$/.test(key)) { usage.packBytes += size; usage.packs++; }
    else if (/^objects\/pack\/pack-[0-9a-f]+\.idx$/.test(key)) usage.indexBytes += size;
    else usage.metadataBytes += size;
  }
  usage.objects = (await odb.list({ signal })).length;
  return usage;
}

async function rootsFor(options) {
  const { refs, index, signal, includeReflogs = true } = options;
  const references = await refs.list('refs/', { signal });
  const roots = new Set(references.map(ref => ref.oid).filter(Boolean));
  const head = await refs.read('HEAD', { signal });
  if (head) roots.add(head);
  for (const entry of index?.entries ?? []) if (entry.mode !== 0o160000) roots.add(entry.oid);
  if (includeReflogs) for (const name of ['HEAD', ...references.map(ref => ref.name)]) {
    for (const entry of await refs.reflog(name, { signal })) {
      if (entry.oldOid && !/^0+$/.test(entry.oldOid)) roots.add(entry.oldOid);
      if (entry.newOid && !/^0+$/.test(entry.newOid)) roots.add(entry.newOid);
    }
  }
  for (const oid of options.extraRoots ?? []) roots.add(oid);
  return { roots, references, head };
}

async function retainedObjects(options, roots) {
  const { odb, algorithm = 'sha1', signal, graceSeconds = 14 * 86400, now = Math.floor(Date.now() / 1000), objectTimestamp } = options;
  checkLimit(graceSeconds, Number.MAX_SAFE_INTEGER, 'Prune grace period');
  checkLimit(now, Number.MAX_SAFE_INTEGER, 'Maintenance timestamp');
  const shallow = parseShallow(await odb.store.get('shallow', { signal }), { algorithm });
  const reachable = await collectReachable({ ...options, tips: [...roots], shallow });
  const bytes = await odb.store.get(AGE_LEDGER, { signal });
  let times;
  try { times = bytes ? JSON.parse(decodeText(bytes)) : {}; }
  catch { throw new GitError('Corrupt', 'Object-age ledger is invalid'); }
  const keep = new Set(reachable);
  const pruned = [];
  const nextTimes = {};
  for (const oid of await odb.list({ signal })) {
    checkCancelled(signal);
    if (reachable.has(oid)) continue;
    const timestamp = await objectTimestamp?.(oid) ?? times[oid] ?? now;
    checkLimit(timestamp, Number.MAX_SAFE_INTEGER, 'Object timestamp');
    if (options.prune !== false && timestamp <= now - graceSeconds) pruned.push(oid);
    else { keep.add(oid); nextTimes[oid] = timestamp; }
  }
  const closure = await collectReachable({ ...options, tips: [...keep], shallow });
  return { reachable, keep: closure, pruned: pruned.filter(oid => !closure.has(oid)), times: nextTimes };
}

/** Prepare one self-contained pack, then atomically replace older packs and packed loose copies. */
export async function repackRepository(options) {
  const { odb, refs, algorithm = 'sha1', signal } = options;
  const before = await repositoryStorageUsage(options);
  const snapshot = await maintenanceSnapshot(odb.store, signal);
  const rootState = await rootsFor(options);
  const retained = await retainedObjects(options, rootState.roots);
  const ids = [...retained.keep].sort();
  const objects = (async function* () { for (const oid of ids) yield await odb.read(oid, { signal }); })();
  const encoded = await writePack(objects, { ...options, count: ids.length });
  const size = getObjectFormat(algorithm).oidBytes;
  const checksum = bytesToHex(encoded.pack.subarray(encoded.pack.length - size));
  const index = await writePackIndex(encoded.entries, checksum, { algorithm });
  const reader = await createPackReader({ pack: encoded.pack, index, algorithm, signal });
  if (typeof odb.replacePackReaders !== 'function') throw new GitError('Unsupported', 'Object database cannot replace registered pack readers');
  const current = await refs.list('refs/', { signal });
  if (JSON.stringify(current) !== JSON.stringify(rootState.references) || await refs.read('HEAD', { signal }) !== rootState.head) {
    throw new GitError('Conflict', 'Repository references changed during maintenance; retry with a repository write lock');
  }
  checkCancelled(signal);
  const pruneSet = new Set(retained.pruned);
  await odb.store.transaction(async transaction => {
    if (!sameSnapshot(snapshot, await maintenanceSnapshot(transaction, signal))) {
      throw new GitError('Conflict', 'Repository changed during maintenance');
    }
    await transaction.set(`objects/pack/pack-${checksum}.pack`, encoded.pack);
    await transaction.set(`objects/pack/pack-${checksum}.idx`, index);
    for (const key of await transaction.list('objects/')) {
      const loose = /^objects\/([0-9a-f]{2})\/([0-9a-f]+)$/.exec(key);
      if (loose && (retained.keep.has(loose[1] + loose[2]) || pruneSet.has(loose[1] + loose[2]))) {
        await transaction.delete(key);
      } else if (/^objects\/pack\/pack-[0-9a-f]+\.(?:pack|idx|rev|bitmap)$/.test(key) && !key.includes(`pack-${checksum}.`)) {
        await transaction.delete(key);
      }
    }
    await transaction.set(AGE_LEDGER, encodeText(JSON.stringify(retained.times)));
  }, { signal });
  odb.replacePackReaders([reader]);
  return { pack: checksum, packed: ids.length, reachable: retained.reachable.size, pruned: retained.pruned,
    before, after: await repositoryStorageUsage(options) };
}

export const gcRepository = options => repackRepository(options);

/** Prune uses the same reachability and grace policy; repacking also removes unreachable packed objects. */
export const pruneRepository = options => repackRepository({ ...options, prune: true });
