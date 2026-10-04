import { GitService } from '../packages/git/src/service.js';
import { viewOperations } from '../packages/git/src/view-operations.js';
import { repository } from './a25-workflow-fixtures.js';

/** Exercise the production service queue and repository implementations without a simulated RPC responder. */
export async function viewFixture(t, options = {}) {
  const repo = await repository(options);
  const service = new GitService({ repositoryFactory: async () => repo, operations: viewOperations });
  service.attach('ui', repo);
  t.after(() => service.dispose());
  return { repo, service, run: (method, params = {}, context) => service.request(method, { repositoryId: 'ui', ...params }, context) };
}

export function comparisonSelection(comparison, options = {}) {
  return { path: comparison.path, staged: comparison.staged, beforeOid: comparison.before.oid, afterOid: comparison.after.oid,
    beforeMode: comparison.before.mode, afterMode: comparison.after.mode, ...options };
}

export async function conflictStages(repo, path, { base, ours, theirs, oursMode = 0o100644, theirsMode = 0o100644 }) {
  const next = repo.index.clone();
  next.remove(path);
  for (const [stage, data, mode] of [[1, base, 0o100644], [2, ours, oursMode], [3, theirs, theirsMode]]) {
    if (data === null || data === undefined) continue;
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const oid = await repo.odb.write('blob', bytes);
    next.set({ path, oid, mode, stage });
  }
  await repo.replaceIndex(next);
  if (ours !== null && ours !== undefined) await repo.worktree.write(path, ours, { mode: oursMode });
}
