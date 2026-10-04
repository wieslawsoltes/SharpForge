import { GitError, checkCancelled } from './errors.js';

const options = (params, context) => ({ ...params, ...context });
const mutation = (name, run) => Object.freeze({ name, run, mutates: true });
const query = (name, run) => Object.freeze({ name, run, mutates: false });

/** Explicit command descriptors form the extension seam used by local and remote Git. */
export const repositoryOperations = Object.freeze([
  query('status', (repo, params, context) => repo.status(options(params, context))),
  query('log', (repo, params, context) => repo.log(options(params, context))),
  query('diff', (repo, params, context) => repo.diff(options(params, context))),
  query('blame', (repo, params, context) => repo.blame(params.path, options(params, context))),
  query('revParse', (repo, params, context) => repo.revParse(params.revision, options(params, context))),
  query('branches', (repo, params, context) => repo.refs.list(params.prefix ?? 'refs/heads/', context)),
  query('readFile', async (repo, params, context) => {
    checkCancelled(context.signal);
    if (!params.revision) return repo.worktree.read(params.path, context);
    const tree = await repo.readTree(params.revision, context);
    const entry = tree.get(params.path);
    if (!entry) throw new GitError('NotFound', 'File does not exist in the selected revision', { path: params.path });
    return { ...await repo.odb.read(entry.oid, context), mode: entry.mode };
  }),
  mutation('writeFile', (repo, params, context) => repo.worktree.write(params.path, params.data, options(params, context))),
  mutation('add', (repo, params, context) => repo.add(params.paths ?? params.path, options(params, context))),
  mutation('remove', (repo, params, context) => repo.remove(params.paths ?? params.path, options(params, context))),
  mutation('move', (repo, params, context) => repo.move(params.from, params.to, options(params, context))),
  mutation('unstage', (repo, params, context) => repo.unstage(params.paths ?? params.path, options(params, context))),
  mutation('stagePatch', (repo, params, context) => repo.stagePatch(params.path, params.patch, options(params, context))),
  mutation('commit', (repo, params, context) => repo.commit(options(params, context))),
  mutation('checkout', (repo, params, context) => repo.checkout(params.revision, options(params, context))),
  mutation('branch', (repo, params, context) => repo.branch(params.name, options(params, context))),
  mutation('tag', (repo, params, context) => repo.tag(params.name, options(params, context))),
  mutation('merge', (repo, params, context) => repo.merge(params.revision, options(params, context))),
  mutation('rebase', (repo, params, context) => repo.rebase(params.onto, options(params, context))),
  mutation('cherryPick', (repo, params, context) => repo.cherryPick(params.revision, options(params, context))),
  mutation('revert', (repo, params, context) => repo.revert(params.revision, options(params, context))),
  mutation('stash', (repo, params, context) => repo.stash(params.action ?? 'push', options(params, context))),
  mutation('reset', (repo, params, context) => repo.reset(params.revision, options(params, context))),
  mutation('restore', (repo, params, context) => repo.restore(params.paths ?? params.path, options(params, context)))
]);
