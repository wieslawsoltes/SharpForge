import { GitError } from './errors.js';
import { encodeTag } from './objects.js';
import { commitIdentity } from './commit.js';
import { validateRefName } from './refs.js';

function branchRef(name) {
  const ref = name.startsWith('refs/heads/') ? name : `refs/heads/${name}`;
  validateRefName(ref);
  return ref;
}

async function reflogOptions(repo, ref, options) {
  const configured = repo.config.get('core.logallrefupdates');
  const enabled = configured ?? ![true, 'true'].includes(repo.config.get('core.bare'));
  const existing = await repo.store.get(`logs/${ref}`, options);
  const reflog = options.createReflog === true || existing !== undefined || enabled === 'always'
    || (!ref.startsWith('refs/tags/') && ![false, 'false'].includes(enabled));
  const explicit = options.identity ?? options.committer;
  const hasIdentity = explicit || (repo.config.get('user.name') && repo.config.get('user.email'));
  return { signal: options.signal, reflog, identity: hasIdentity ? commitIdentity(repo, explicit, options) : undefined };
}

/** Create a branch and optionally configure its remote tracking relationship. */
export async function createBranch(repo, name, { start = 'HEAD', upstream, force = false, ...options } = {}) {
  const ref = branchRef(name);
  const oid = await repo.revParse(start, options);
  if (typeof oid !== 'string') throw new GitError('Corrupt', 'Branch start requires one revision');
  await repo.readCommit(oid, options);
  const previous = await repo.refs.read(ref);
  if (previous && !force) throw new GitError('Conflict', 'Branch already exists', { name });
  if (previous && (await repo.refs.resolve('HEAD')).ref === ref) throw new GitError('Conflict', 'Cannot reset the checked-out branch');
  await repo.refs.update(ref, oid, { ...await reflogOptions(repo, ref, options), expected: previous,
    message: `branch: ${previous ? 'Reset to' : 'Created from'} ${start}` });
  if (upstream) {
    const branch = ref.slice(11);
    const remote = upstream.remote ?? (upstream.startsWith?.('refs/heads/') ? '.' : upstream.split('/')[0]);
    const merge = upstream.merge ?? (remote === '.' ? upstream : `refs/heads/${upstream.split('/').slice(1).join('/')}`);
    repo.config.set(`branch.${branch}.remote`, remote).set(`branch.${branch}.merge`, merge);
    await repo.config.save(options);
  }
  return { name: ref, oid };
}

/** Delete a branch only after a merged check, unless the caller explicitly forces it. */
export async function deleteBranch(repo, name, { force = false, ...options } = {}) {
  const ref = branchRef(name);
  const head = await repo.refs.resolve('HEAD');
  if (head.ref === ref) throw new GitError('Conflict', 'Cannot delete the checked-out branch', { name });
  const oid = await repo.refs.read(ref);
  if (!oid) throw new GitError('NotFound', 'Branch does not exist', { name });
  if (!force && (!head.oid || !await repo.graph.isAncestor(oid, head.oid, options))) {
    throw new GitError('Conflict', 'Branch contains commits not merged into HEAD', { name });
  }
  await repo.refs.delete(ref, { expected: oid, signal: options.signal, reflog: false, deleteReflog: true });
  const prefix = `branch.${ref.slice(11)}.`;
  for (const entry of repo.config.entries()) {
    const key = Array.isArray(entry) ? entry[0] : entry.key;
    if (key?.startsWith(prefix)) repo.config.unset(key);
  }
  await repo.config.save(options);
  return { name: ref, oid };
}

/** Rename refs atomically, preserve the branch's reflog and update symbolic HEAD when necessary. */
export async function renameBranch(repo, name, target, { force = false, ...options } = {}) {
  const before = branchRef(name);
  const after = branchRef(target);
  if (before === after) return { name: after, oid: await repo.refs.read(before) };
  const oid = await repo.refs.read(before);
  const previous = await repo.refs.read(after);
  if (!oid) throw new GitError('NotFound', 'Branch does not exist', { name });
  if (previous && !force) throw new GitError('Conflict', 'Branch destination exists', { target });
  const head = await repo.refs.read('HEAD', { deref: false });
  if (previous && head === after) throw new GitError('Conflict', 'Cannot replace the checked-out branch');
  await repo.refs.rename(before, after, { ...await reflogOptions(repo, before, options), expected: oid, expectedTarget: previous,
    message: `Branch: renamed ${before} to ${after}` });
  const prefix = `branch.${before.slice(11)}.`;
  for (const entry of [...repo.config.entries()]) {
    const key = Array.isArray(entry) ? entry[0] : entry.key;
    const value = Array.isArray(entry) ? entry[1] : entry.value;
    if (!key?.startsWith(prefix)) continue;
    repo.config.set(`branch.${after.slice(11)}.${key.slice(prefix.length)}`, value);
    repo.config.unset(key);
  }
  await repo.config.save(options);
  return { name: after, oid };
}

/** Create lightweight or annotated tag objects; signatures use the explicit signing extension. */
export async function createTag(repo, name, { target = 'HEAD', message, tagger, force = false, ...options } = {}) {
  const ref = name.startsWith('refs/tags/') ? name : `refs/tags/${name}`;
  validateRefName(ref);
  const previous = await repo.refs.read(ref);
  if (previous && !force) throw new GitError('Conflict', 'Tag already exists', { name });
  let oid = await repo.revParse(target, options);
  if (typeof oid !== 'string') throw new GitError('Corrupt', 'Tag target requires one revision');
  if (message !== undefined || options.annotated) {
    const object = await repo.odb.read(oid, options);
    const data = encodeTag({ object: oid, type: object.type, tag: ref.slice(10),
      tagger: commitIdentity(repo, tagger, options), message: `${String(message ?? '').trimEnd()}\n` }, { algorithm: repo.algorithm });
    oid = await repo.odb.write('tag', data, options);
  }
  await repo.refs.update(ref, oid, { ...await reflogOptions(repo, ref, options), expected: previous, message: `tag: ${name}` });
  return { name: ref, oid };
}

export async function deleteTag(repo, name, options = {}) {
  const ref = name.startsWith('refs/tags/') ? name : `refs/tags/${name}`;
  const oid = await repo.refs.read(ref);
  if (!oid) throw new GitError('NotFound', 'Tag does not exist', { name });
  await repo.refs.delete(ref, { expected: oid, signal: options.signal, reflog: false, deleteReflog: true });
  return { name: ref, oid };
}
