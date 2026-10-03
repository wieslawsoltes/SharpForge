import { GitError, checkCancelled, checkLimit } from '../errors.js';

export function packPaths(id) {
  if (typeof id !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(id)) {
    throw new GitError('Corrupt', 'Invalid pack identifier');
  }
  const base = `objects/pack/pack-${id}`;
  return { pack: `${base}.pack`, index: `${base}.idx` };
}

/** Commit the pack and its index together; quota/cancellation leaves neither behind. */
export async function installPack(store, { id, pack, index }, { signal, maxPackBytes = 512 * 1024 * 1024 } = {}) {
  checkCancelled(signal);
  if (!(pack instanceof Uint8Array) || !(index instanceof Uint8Array)) throw new TypeError('Pack and index must be bytes');
  checkLimit(pack.byteLength + index.byteLength, maxPackBytes, 'Stored pack');
  const paths = packPaths(id);
  await store.transaction(async tx => {
    await tx.set(paths.pack, pack);
    await tx.set(paths.index, index);
  }, { signal });
  return id;
}

export async function readPack(store, id, options = {}) {
  const paths = packPaths(id);
  const [pack, index] = await Promise.all([store.get(paths.pack, options), store.get(paths.index, options)]);
  if (pack === undefined || index === undefined) throw new GitError('NotFound', 'Repository pack is missing', { id });
  return { id, pack, index };
}

export async function removePack(store, id, options = {}) {
  const paths = packPaths(id);
  await store.transaction(async tx => {
    await tx.delete(paths.pack);
    await tx.delete(paths.index);
  }, options);
}

export async function listPacks(store, options = {}) {
  const keys = await store.list('objects/pack/', options);
  return keys.filter(key => /^objects\/pack\/pack-(?:[0-9a-f]{40}|[0-9a-f]{64})\.idx$/u.test(key))
    .map(key => key.slice('objects/pack/pack-'.length, -4));
}
