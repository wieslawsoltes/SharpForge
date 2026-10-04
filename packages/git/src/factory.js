import { GitService } from './service.js';
import { GitRepository } from './repository.js';
import { ObjectDatabase } from './odb.js';
import { MemoryStore } from './storage/memory-store.js';
import { MemoryWorktree, KeyValueWorktree } from './worktree.js';
import { createBrowserObjectDatabase } from './storage/browser.js';
import { openLocalRepository, initLocalRepository } from './fs-odb.js';
import { initializeRepositoryStore, readRepositoryMetadata } from './fs/repository.js';
import { createPackReader } from './pack/accessor.js';
import { recoverClone } from './clone.js';
import { GitError, checkCancelled } from './errors.js';
import { studioOperations } from './studio-operations.js';
import { createGitAuthContext } from './auth/context.js';
import { createAuthOperations } from './auth/service.js';
import { createRemoteOperations, createRemoteAccess, remoteConnectionSelection } from './remote-operations.js';
import { createAdjunctOperations } from './adjunct-operations.js';
import { createLocalLfsAdapter } from './adjunct/lfs.js';
import { attachPromisorDatabase, readPromisorDescription } from './adjunct/promisor.js';
import { GitExecutionPolicy } from './policy.js';
import { viewOperations } from './view-operations.js';
import { createSubmoduleRepository, createSubmoduleStateAdapter } from './adjunct/nested.js';

async function browserComponents(options) {
  const { method, backend, signal } = options;
  if (backend === 'memory' && method === 'open') {
    throw new GitError('NotFound', 'An in-memory repository cannot survive a closed session');
  }
  const storage = backend === 'memory' ? { store: new MemoryStore(), backend } : await createBrowserObjectDatabase(options);
  const { store } = storage;
  try {
    if (method === 'init') await initializeRepositoryStore(store, options);
    const metadata = await readRepositoryMetadata(store, { signal });
    const odb = new ObjectDatabase({ store, algorithm: metadata.algorithm });
    const readers = [];
    for (const id of await store.listPacks({ signal })) {
      const { pack, index } = await store.readPack(id, { signal });
      readers.push(await createPackReader({ pack, index, algorithm: metadata.algorithm, signal }));
    }
    odb.replacePackReaders(readers);
    return { ...storage, ...metadata, odb, worktree: backend === 'memory'
      ? new MemoryWorktree(options.files ?? {}) : new KeyValueWorktree(store) };
  } catch (error) { await store.close(); throw error; }
}

async function inspectRecovery(components, options) {
  const recovery = await recoverClone({ ...components, action: 'inspect' });
  if (!recovery.journal) return null;
  if (options.cloneRecovery === 'cleanup') {
    await recoverClone({ ...components, action: 'cleanup' });
    components.odb.replacePackReaders([]);
    await components.config.load(options);
    return null;
  }
  if (options.cloneRecovery === 'resume') return { phase: recovery.journal.phase };
  throw new GitError('Conflict', 'Repository has an interrupted clone; choose resume or cleanup before opening', {
    phase: recovery.journal.phase, recoveryOptions: ['resume', 'cleanup']
  });
}

/** Open a repository using its stored object format and the backend that is actually available. */
export async function createRepository(input = {}) {
  const options = { method: 'init', repositoryId: 'default', backend: 'memory', defaultBranch: 'main', ...input };
  checkCancelled(options.signal);
  const components = options.directory
    ? await (options.method === 'init' ? initLocalRepository : openLocalRepository)(options)
    : await browserComponents(options);
  let repository;
  const dispose = async () => {
    try { await repository?.dispose(); }
    finally { await components.store.close(); }
  };
  try {
    const recovery = await inspectRecovery(components, options);
    const lfs = options.lfs ?? createLocalLfsAdapter(components.store);
    const policy = new GitExecutionPolicy({ notice: options.policy?.notice,
      signers: options.policy?.signers, filters: new Map([...(options.policy?.filters ?? []), ['lfs', lfs]]) });
    repository = new GitRepository({ ...components, dirtyBuffers: options.dirtyBuffers, lfs, policy });
    repository.setSubmoduleAdapter(createSubmoduleStateAdapter(repository));
    const promisor = await readPromisorDescription(components.store, options);
    if (promisor) attachPromisorDatabase(repository, promisor, options.promisorFetcher);
    await repository.refreshShallow(options);
    await repository.loadIndex(options);
    await repository.loadRules(options);
    checkCancelled(options.signal);
    return { repository, dispose, description: {
      backend: (components.backend ?? components.store.capabilities.backend).startsWith('opfs')
        ? 'opfs' : components.backend ?? components.store.capabilities.backend,
      algorithm: components.algorithm, name: options.name ?? options.repositoryId, recovery,
      capabilities: components.capabilities ?? components.store.capabilities
    } };
  } catch (error) { await dispose(); throw error; }
}

/** Authentication state belongs to one service session; credentials never enter repository storage. */
export function createGitService(options = {}) {
  const auth = options.authContext ?? createGitAuthContext(options.authentication);
  const remoteAccess = createRemoteAccess(auth, options);
  const submodules = { createRepository: createSubmoduleRepository, ...options.submodules };
  const repositoryFactory = options.repositoryFactory ?? (params => {
    const connection = remoteConnectionSelection(params);
    const notice = value => {
      options.policy?.notice?.(value);
      options.onDiagnostic?.(auth.redactor.value({ kind: 'git-policy', repositoryId: params.repositoryId ?? 'default', ...value }));
    };
    return createRepository({ ...params, ...options.repositoryOptions, policy: { ...options.policy, notice },
      allowInsecureLocalhost: options.allowInsecureLocalhost === true,
      promisorFetcher: request => remoteAccess.hydrate({ ...request, connection }) });
  });
  return new GitService({
    ...options, repositoryFactory,
    resources: [auth, ...options.resources ?? []],
    serializeError: error => auth.redactor.value(GitError.from(error).toJSON()),
    operations: [...studioOperations, ...viewOperations, ...createAuthOperations(auth, options),
      ...createRemoteOperations(auth, { ...options, remoteAccess }),
      ...createAdjunctOperations({ ...options, submodules, remoteAccess, redactor: auth.redactor }),
      ...options.operations ?? []]
  });
}
