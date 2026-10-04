import { createGitService, createGitWorkerServer, encodeCommit, encodeTree, checkCancelled, checkLimit } from '@sharpforge/git';

/** Generate actual hashed Git objects in this worker; ordinary production RPC reads the resulting repository. */
async function seedHistory(repository, { count = 10000 }, context) {
  checkLimit(count, 100000, 'Acceptance history count');
  if (count < 32) throw new Error('The graph fixture requires at least 32 commits');
  if (await repository.refs.read('HEAD')) throw new Error('The graph fixture must begin with an empty repository');
  const started = performance.now();
  const data = new TextEncoder().encode('class Program { static void Main() {} }\n');
  const blob = await repository.odb.write('blob', data, context);
  const tree = await repository.odb.write('tree', encodeTree([
    { name: 'Program.cs', mode: 0o100644, oid: blob }
  ], { algorithm: repository.algorithm }), context);
  const commits = [];
  let merges = 0;
  for (let position = 0; position < count; position++) {
    checkCancelled(context.signal);
    const parents = position === 0 ? [] : position % 32 === 30 ? [commits[position - 2]]
      : position % 32 === 31 ? [commits[position - 2], commits[position - 1]] : [commits[position - 1]];
    if (parents.length === 2) merges++;
    const identity = { name: `Fixture author ${position % 7}`, email: `author${position % 7}@example.invalid`,
      timestamp: 1700000000 + position, timezone: '+0000' };
    const commit = encodeCommit({ tree, parents, author: identity, committer: identity,
      message: `Graph fixture commit ${String(position).padStart(5, '0')}\n`
    }, { algorithm: repository.algorithm });
    commits.push(await repository.odb.write('commit', commit, context));
    if ((position + 1) % 250 === 0) context.onProgress?.({ phase: 'seed', completed: position + 1, total: count });
  }
  await repository.refs.update('refs/heads/main', commits.at(-1), { expected: null, signal: context.signal });
  await repository.refs.update('refs/heads/fixture-side', commits[30], { expected: null, signal: context.signal });
  const objects = await repository.odb.list(context);
  if (objects.length !== count + 2) throw new Error('Generated history contains an unexpected object count');
  return { count, merges, objectCount: objects.length, tree, blob, head: commits.at(-1), first: commits[0],
    algorithm: repository.algorithm, backend: repository.store.capabilities.backend,
    generatedInWorker: typeof document === 'undefined', elapsedMs: performance.now() - started };
}

createGitWorkerServer({ endpoint: globalThis, createService: () => createGitService({
  operations: [{ name: 'fixture.seedHistory', mutates: true, run: seedHistory }]
}) });
