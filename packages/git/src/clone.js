import { GitError, checkCancelled } from './errors.js';
import { fetchRemote } from './fetch.js';
import { encodeText, decodeText } from './protocol/bytes.js';
import { validateRefName } from './refs/names.js';

export const CLONE_JOURNAL_KEY = 'sharpforge/clone-journal';
export const CLONE_CHECKPOINTS = Object.freeze(['created', 'fetching', 'verified', 'planning-refs',
  'publishing-refs', 'head', 'config', 'checkout', 'complete', 'cleanup']);

function journalBytes(journal) { return encodeText(JSON.stringify(journal)); }

async function loadJournal(store) {
  const bytes = await store.get(CLONE_JOURNAL_KEY);
  if (!bytes) return null;
  let journal;
  try { journal = JSON.parse(decodeText(bytes)); }
  catch { throw new GitError('Corrupt', 'Clone recovery journal is invalid'); }
  if (journal.version !== 1 || !Array.isArray(journal.baseline)) throw new GitError('Corrupt', 'Unknown clone recovery journal version');
  return journal;
}

async function checkpoint(store, journal, phase, options) {
  checkCancelled(options.signal);
  journal.phase = phase;
  await store.set(CLONE_JOURNAL_KEY, journalBytes(journal), { signal: options.signal });
  await options.onCheckpoint?.(phase);
}

async function clearWorktree(worktree) {
  if (!worktree) return;
  const entries = await worktree.list();
  const paths = entries.map(entry => typeof entry === 'string' ? entry : entry.path).sort((left, right) => right.length - left.length);
  for (const path of paths) await worktree.remove(path);
}

/** Restore the empty destination baseline after interrupted clone; never delete a pre-existing repository. */
export async function recoverClone({ odb, worktree, action = 'cleanup' }) {
  const store = odb.store;
  const journal = await loadJournal(store);
  if (!journal) return { recovered: false };
  if (action === 'inspect') return { recovered: false, journal };
  if (action !== 'cleanup') throw new GitError('Unsupported', 'Unknown clone recovery action');
  await store.transaction(async transaction => {
    for (const key of await transaction.list('')) await transaction.delete(key);
    for (const [key, bytes] of journal.baseline) await transaction.set(key, Uint8Array.from(bytes));
  });
  await clearWorktree(worktree);
  return { recovered: true, phase: journal.phase };
}

function selectHead(remoteRefs, branch) {
  if (branch) {
    const name = branch.startsWith('refs/') ? branch : `refs/heads/${branch}`;
    validateRefName(name);
    const selected = remoteRefs.find(ref => ref.name === name) ?? remoteRefs.find(ref => ref.name === `refs/tags/${branch}`);
    if (!selected) throw new GitError('NotFound', 'Requested clone branch was not advertised', { name });
    return selected;
  }
  const head = remoteRefs.find(ref => ref.name === 'HEAD');
  const symref = head?.symref ?? head?.symbolic;
  if (symref) return remoteRefs.find(ref => ref.name === symref) ?? { name: symref, oid: null };
  return remoteRefs.find(ref => ref.name === 'refs/heads/main') ?? remoteRefs.find(ref => ref.name === 'refs/heads/master') ??
    remoteRefs.find(ref => ref.name.startsWith('refs/heads/')) ?? { name: 'refs/heads/main', oid: head?.oid ?? null };
}

async function publishRemoteHead(refs, remoteRefs, remoteName, signal) {
  const head = remoteRefs.find(ref => ref.name === 'HEAD');
  const target = head?.symref ?? head?.symbolic;
  if (!head?.oid || !target?.startsWith('refs/heads/')) return;
  const tracking = `refs/remotes/${remoteName}/${target.slice(11)}`;
  if (await refs.read(tracking, { signal }) !== head.oid) return;
  const name = `refs/remotes/${remoteName}/HEAD`;
  const expected = await refs.read(name, { signal, deref: false });
  await refs.setSymbolic(name, tracking, { signal, expected });
}

/** Clone into an empty owned destination. A verified checkpoint is reusable after worker termination. */
export async function cloneRepository(options) {
  const { odb, refs, worktree, config, url, algorithm = 'sha1', remoteName = 'origin', signal, checkout } = options;
  if (!odb.store?.transaction) throw new GitError('Unsupported', 'Clone requires a transactional repository store');
  let journal = await loadJournal(odb.store);
  const resumed = journal !== null;
  if (journal && (journal.url !== url || journal.algorithm !== algorithm)) throw new GitError('Conflict', 'Destination contains a different interrupted clone');
  if (!journal) {
    if ((await odb.list({ signal })).length || (await refs.list('refs/', { signal })).length) {
      throw new GitError('Conflict', 'Clone destination already contains a repository');
    }
    if (worktree && (await worktree.list()).length) throw new GitError('Conflict', 'Clone worktree destination is not empty');
    const baseline = [];
    for (const key of await odb.store.list('')) baseline.push([key, [...await odb.store.get(key)]]);
    journal = { version: 1, url, algorithm, phase: 'created', baseline, refs: null, pack: null };
  }
  try {
    if (!resumed) await checkpoint(odb.store, journal, 'created', options);
    if (!journal.refs) {
      if (journal.phase !== 'created') {
        await recoverClone({ odb, worktree });
        await checkpoint(odb.store, journal, 'created', options);
      }
      await checkpoint(odb.store, journal, 'fetching', options);
      const fetched = await fetchRemote({ ...options, updateRefs: false });
      journal.refs = fetched.remote.refs;
      journal.pack = fetched.pack ? { checksum: fetched.pack.checksum, count: fetched.pack.count } : null;
      await checkpoint(odb.store, journal, 'verified', options);
    }
    await checkpoint(odb.store, journal, 'planning-refs', options);
    const selected = selectHead(journal.refs, options.branch);
    for (const ref of journal.refs) if (ref.oid && ref.name === selected.name) {
      if (!await odb.has(ref.oid, { signal })) throw new GitError('Corrupt', 'Clone checkpoint is missing an advertised object', { oid: ref.oid });
    }
    await checkpoint(odb.store, journal, 'publishing-refs', options);
    const updates = [];
    for (const ref of journal.refs) {
      if (!ref.oid || ref.name.endsWith('^{}')) continue;
      if (!await odb.has(ref.oid, { signal })) continue;
      const name = ref.name.startsWith('refs/heads/') ? `refs/remotes/${remoteName}/${ref.name.slice(11)}` :
        ref.name.startsWith('refs/tags/') && await odb.has(ref.oid, { signal }) ? ref.name : null;
      if (name) updates.push({ name, oid: ref.oid, expected: await refs.read(name), message: 'clone' });
    }
    if (selected.oid && selected.name.startsWith('refs/heads/')) {
      updates.push({ name: selected.name, oid: selected.oid, expected: await refs.read(selected.name), message: 'clone HEAD' });
    }
    await refs.transaction(updates, { signal });
    await checkpoint(odb.store, journal, 'head', options);
    await publishRemoteHead(refs, journal.refs, remoteName, signal);
    if (selected.name.startsWith('refs/heads/')) await refs.setSymbolic('HEAD', selected.name, { signal });
    else await refs.update('HEAD', selected.oid, { signal, deref: false });
    await checkpoint(odb.store, journal, 'config', options);
    if (config) {
      await config.load({ signal });
      config.set(`remote.${remoteName}.url`, url);
      config.set(`remote.${remoteName}.fetch`, `+refs/heads/*:refs/remotes/${remoteName}/*`);
      if (selected.name.startsWith('refs/heads/')) {
        config.set(`branch.${selected.name.slice(11)}.remote`, remoteName);
        config.set(`branch.${selected.name.slice(11)}.merge`, selected.name);
      }
      await config.save({ signal });
    }
    await checkpoint(odb.store, journal, 'checkout', options);
    if (checkout && selected.oid && options.noCheckout !== true) await checkout({ ...options, oid: selected.oid, ref: selected.name });
    await checkpoint(odb.store, journal, 'complete', options);
    await checkpoint(odb.store, journal, 'cleanup', options);
    await odb.store.delete(CLONE_JOURNAL_KEY, { signal });
    return { branch: selected.name, oid: selected.oid, remoteName, pack: journal.pack, resumed };
  } catch (error) {
    if (options.retainInterrupted !== true) await recoverClone({ odb, worktree });
    throw GitError.from(error);
  }
}
