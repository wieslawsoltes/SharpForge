import { parentPort, workerData, threadId } from 'node:worker_threads';
import { GitRepository, GitError, HttpGitTransport, cloneRepository, recoverClone,
  CLONE_JOURNAL_KEY } from '../../packages/git/src/index.js';
import { initNodeRepository, openNodeRepository } from '../../packages/git/src/fs/node.js';

/** A real worker boundary: checkpoint holds never throw or run clone's recovery/finally path. */
async function run() {
  const { action, directory, url, phase, noNetwork = false } = workerData;
  const descriptor = action === 'interrupt' ? await initNodeRepository({ directory }) : await openNodeRepository({ directory });
  const repository = new GitRepository(descriptor);
  let requests = 0;
  try {
    await repository.loadIndex();
    const interrupted = await recoverClone({ ...descriptor, action: 'inspect' });
    if (action === 'cleanup') {
      const result = await recoverClone(descriptor);
      const metadata = [];
      for (const key of await descriptor.store.list('')) metadata.push([key, [...await descriptor.store.get(key)]]);
      return { ...result, threadId, backend: descriptor.capabilities.backend, metadata,
        head: await descriptor.refs.read('HEAD'), objects: (await descriptor.odb.list()).length,
        paths: await descriptor.worktree.list(), journal: await descriptor.store.get(CLONE_JOURNAL_KEY) ?? null };
    }
    const origin = new URL(url).origin;
    const transport = new HttpGitTransport({ origins: [origin], allowInsecureLocalhost: true,
      fetch: (target, options) => {
        requests++;
        if (noNetwork) throw new Error('Verified clone resume attempted a network request');
        return fetch(target, options);
      } });
    const result = await cloneRepository({ ...descriptor, url, transport, retainInterrupted: true,
      checkout: ({ ref, oid }) => repository.checkout(ref ?? oid, { force: true, replaceAll: true }),
      onCheckpoint: async current => {
        if (action !== 'interrupt' || current !== phase) return;
        const bytes = await descriptor.store.get(CLONE_JOURNAL_KEY);
        const persisted = JSON.parse(new TextDecoder().decode(bytes));
        parentPort.postMessage({ type: 'checkpoint', phase: current, persistedPhase: persisted.phase,
          threadId, backend: descriptor.capabilities.backend, requests, verified: !!persisted.refs });
        // The parent terminates this worker while this port keeps its event loop alive.
        await new Promise(resolve => parentPort.once('message', resolve));
      } });
    return { ...result, threadId, backend: descriptor.capabilities.backend, requests,
      recoveredPhase: interrupted.journal?.phase ?? null, head: await descriptor.refs.read('HEAD'),
      symbolicHead: await descriptor.refs.read('HEAD', { deref: false }), refs: await descriptor.refs.list(),
      remote: descriptor.config.get('remote.origin.url'), objects: (await descriptor.odb.list()).length,
      paths: await descriptor.worktree.list(), status: await repository.status(),
      journal: await descriptor.store.get(CLONE_JOURNAL_KEY) ?? null };
  } finally { await descriptor.odb.close(); }
}

try {
  const result = await run();
  parentPort.postMessage({ type: 'result', result });
} catch (error) {
  parentPort.postMessage({ type: 'error', error: GitError.from(error).toJSON() });
  process.exitCode = 1;
} finally { parentPort.close(); }
