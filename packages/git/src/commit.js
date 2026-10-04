import { GitError, checkCancelled } from './errors.js';
import { encodeCommit } from './objects.js';
import { writeTree } from './worktree-tree.js';
import { signCommitPayload } from './sign.js';

/** Canonical Git commit message cleanup, including strip, whitespace, verbatim and scissors. */
export function cleanupMessage(message, { cleanup = 'strip', commentChar = '#' } = {}) {
  if (typeof message !== 'string' || message.includes('\0')) throw new GitError('Corrupt', 'Commit message must be NUL-free text');
  if (cleanup === 'verbatim') return message;
  if (!['strip', 'whitespace', 'scissors'].includes(cleanup)) throw new GitError('Unsupported', 'Unsupported commit cleanup mode', { cleanup });
  let lines = message.replace(/\r\n/gu, '\n').split('\n');
  if (cleanup === 'scissors') {
    const stop = lines.findIndex(line => line === `${commentChar} ------------------------ >8 ------------------------`);
    if (stop >= 0) lines = lines.slice(0, stop);
  }
  if (cleanup === 'strip') lines = lines.filter(line => !line.startsWith(commentChar));
  const normalized = lines.map(line => line.replace(/[ \t]+$/u, '')).join('\n').replace(/^\n+|\n+$/gu, '').replace(/\n{3,}/gu, '\n\n');
  return normalized ? `${normalized}\n` : '';
}

/** Resolve identity from explicit trusted options or repository user configuration. */
export function commitIdentity(repo, identity, options = {}) {
  if (typeof identity === 'string') return identity;
  const name = identity?.name ?? repo.config?.get('user.name');
  const email = identity?.email ?? repo.config?.get('user.email');
  if (!name || !email || /[\n\r<>]/u.test(name + email)) throw new GitError('Conflict', 'Git user.name and user.email must be configured');
  return { name, email, timestamp: identity?.timestamp ?? options.timestamp ?? Math.floor(Date.now() / 1000),
    timezone: identity?.timezone ?? options.timezone ?? '+0000' };
}

/** Create an immutable commit object, then advance HEAD with a compare-and-swap ref update. */
export async function createCommit(repo, options = {}) {
  checkCancelled(options.signal);
  repo.policy.inspect(repo.config);
  const previous = await repo.refs.read('HEAD');
  const original = previous ? await repo.readCommit(previous, options) : null;
  const tree = options.tree ?? await writeTree(repo, options);
  const mergeHead = await repo.readState('MERGE_HEAD');
  const parents = options.parents ?? (options.amend ? original?.parents ?? [] : [previous, ...(mergeHead?.oids ?? [])].filter(Boolean));
  if (original?.tree === tree && parents.length < 2 && !options.allowEmpty && !options.amend) {
    throw new GitError('Conflict', 'No staged changes to commit');
  }
  const message = cleanupMessage(options.message ?? (options.amend ? original?.message : '') ?? '', options);
  if (!message.trim() && !options.allowEmptyMessage) throw new GitError('Conflict', 'Commit message is empty');
  const committer = commitIdentity(repo, options.committer, options);
  const author = options.author ?? (options.amend && !options.resetAuthor ? original?.author : null) ?? committer;
  const record = { tree, parents, author: commitIdentity(repo, author, options), committer, message, headers: options.headers ?? [] };
  let data = encodeCommit(record, { algorithm: repo.algorithm });
  const signing = options.sign ?? (repo.config?.get('commit.gpgsign') === true || repo.config?.get('commit.gpgsign') === 'true');
  if (signing) {
    const settings = typeof signing === 'object' ? signing : { format: repo.config?.get('gpg.format') ?? 'openpgp' };
    const signature = await signCommitPayload(data, settings, repo.policy);
    data = encodeCommit({ ...record, headers: [...record.headers, { key: 'gpgsig', value: signature.trimEnd() }] }, { algorithm: repo.algorithm });
  }
  const oid = await repo.odb.write('commit', data, options);
  checkCancelled(options.signal);
  await repo.refs.update('HEAD', oid, { expected: previous, identity: committer,
    message: `commit${options.amend ? ' (amend)' : parents.length > 1 ? ' (merge)' : ''}: ${message.split('\n')[0]}` });
  await repo.deleteState('MERGE_HEAD');
  await repo.deleteState('MERGE_MSG');
  await repo.deleteState('merge');
  return { oid, tree, parents, author: record.author, committer, message, signed: !!signing };
}
