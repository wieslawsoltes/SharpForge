import { GitError, checkCancelled } from './errors.js';
import { listRemoteRefs } from './protocol/v2.js';
import { negotiateFetch } from './protocol/fetch.js';
import { readPack } from './pack/reader.js';
import { mapFetchRefs, prunableRefs } from './refspec.js';
import { parseShallow, updateShallow } from './shallow.js';
import { collectAncestors, verifyFetchedClosure } from './remote-graph.js';
import { encodeText } from './protocol/bytes.js';

async function updateFetchRefs(options, remote, mappings, before) {
  const { refs, odb, signal, tags = 'auto', prune = false, refspecs, identity, algorithm = 'sha1' } = options;
  const updates = [];
  for (const mapping of mappings) {
    if (!mapping.destination) continue;
    const expected = before.get(mapping.destination) ?? null;
    if (!mapping.force && expected && expected !== mapping.oid) {
      const ancestors = await collectAncestors({ odb, tips: [mapping.oid], algorithm, signal });
      if (!ancestors.has(expected)) throw new GitError('Conflict', 'Fetch would overwrite a non-fast-forward local reference', { ref: mapping.destination });
    }
    updates.push({ name: mapping.destination, oid: mapping.oid, expected, identity, message: `fetch ${mapping.source}` });
  }
  if (tags !== 'none') {
    const peeled = new Map(remote.refs.filter(ref => ref.name.endsWith('^{}')).map(ref => [ref.name.slice(0, -3), ref.oid]));
    for (const tag of remote.refs.filter(ref => ref.name.startsWith('refs/tags/') && !ref.name.endsWith('^{}'))) {
      if (before.has(tag.name) || updates.some(update => update.name === tag.name)) continue;
      const target = tag.peeled ?? peeled.get(tag.name) ?? tag.oid;
      if (tags === 'all' || await odb.has(target, { signal })) {
        if (await odb.has(tag.oid, { signal })) updates.push({ name: tag.name, oid: tag.oid, expected: null, identity, message: 'fetch tag' });
      }
    }
  }
  if (prune) for (const ref of prunableRefs([...before].map(([name, oid]) => ({ name, oid })), remote.refs, refspecs)) {
    if (!updates.some(update => update.name === ref.name)) updates.push({ name: ref.name, oid: null, expected: ref.oid, identity, message: 'fetch prune' });
  }
  await refs.transaction(updates, { signal });
  return updates;
}

/** Fetch verified objects before atomically publishing tracking refs. Partial data never moves refs. */
export async function fetchRemote(options) {
  const { odb, refs, url, signal, algorithm = 'sha1', remoteName = 'origin', onProgress } = options;
  checkCancelled(signal);
  const refspecs = options.refspecs ?? [`+refs/heads/*:refs/remotes/${remoteName}/*`];
  const remote = options.remote ?? await listRemoteRefs(options);
  const localRefs = await refs.list('refs/', { signal });
  const before = new Map(localRefs.map(ref => [ref.name, ref.oid]));
  const mappings = mapFetchRefs(remote.refs, refspecs);
  const wanted = new Set(options.wants ?? mappings.map(mapping => mapping.oid));
  if (options.branch) {
    const branch = remote.refs.find(ref => ref.name === options.branch
      || ref.name === `refs/heads/${options.branch}` || ref.name === `refs/tags/${options.branch}`);
    if (!branch) throw new GitError('NotFound', 'Requested remote branch or tag is missing', { branch: options.branch });
    if (branch.oid) wanted.add(branch.oid);
  }
  if (options.tags === 'all') for (const ref of remote.refs) if (ref.name.startsWith('refs/tags/') && !ref.name.endsWith('^{}')) wanted.add(ref.oid);
  const shallow = options.shallow ?? parseShallow(await odb.store?.get('shallow', { signal }), { algorithm });
  const deepen = options.depth !== undefined || options.since !== undefined || options.exclude?.length || options.unshallow;
  const wants = [];
  for (const oid of wanted) if (oid && (deepen || options.filter || !await odb.has(oid, { signal }))) wants.push(oid);
  if (options.tags !== 'none') {
    const peeled = new Map(remote.refs.filter(ref => ref.name.endsWith('^{}')).map(ref => [ref.name.slice(0, -3), ref.oid]));
    for (const tag of remote.refs.filter(ref => ref.name.startsWith('refs/tags/') && !ref.name.endsWith('^{}'))) {
      const target = tag.peeled ?? peeled.get(tag.name) ?? tag.oid;
      if (await odb.has(target, { signal }) && !await odb.has(tag.oid, { signal }) && !wants.includes(tag.oid)) {
        wants.push(tag.oid);
        wanted.add(tag.oid);
      }
    }
  }
  let pack = null;
  let state = { shallow: [], unshallow: [] };
  if (wants.length) {
    const haves = options.haves ?? [...await collectAncestors({ odb, tips: localRefs.map(ref => ref.oid), shallow, algorithm, signal })];
    const transfer = await negotiateFetch({ ...options, remote, wants, haves, shallow });
    state = transfer.state;
    pack = await readPack(transfer.pack, { ...options, staging: options.staging ?? odb.store });
    onProgress?.({ phase: 'verified', completed: pack.count, total: pack.count, bytes: pack.bytes });
  }
  for (const oid of wanted) if (oid && !await odb.has(oid, { signal })) throw new GitError('Corrupt', 'Fetch did not provide the wanted tip', { oid });
  const boundary = new Set(shallow);
  for (const oid of state.shallow) boundary.add(oid);
  for (const oid of state.unshallow) boundary.delete(oid);
  const connectivity = await verifyFetchedClosure({ ...options, tips: [...wanted].filter(Boolean), shallow: boundary });
  if (odb.store && (state.shallow.length || state.unshallow.length)) {
    await updateShallow(odb.store, { add: state.shallow, remove: state.unshallow, algorithm, signal });
  }
  checkCancelled(signal);
  const updates = options.updateRefs === false ? [] : await updateFetchRefs({ ...options, refspecs }, remote, mappings, before);
  if (odb.store) {
    if (options.writeFetchHead !== false) {
      const lines = mappings.map(mapping => `${mapping.oid}\t\t${mapping.source} of ${url}`);
      await odb.store.set('FETCH_HEAD', encodeText(lines.length ? `${lines.join('\n')}\n` : ''), { signal });
    }
    if (options.filter) await odb.store.set('sharpforge/promisor', encodeText(JSON.stringify({ url, filter: options.filter, algorithm })), { signal });
  }
  return { remote, pack, updates, mappings, shallow: state, connectivity, fetched: pack?.count ?? 0 };
}
