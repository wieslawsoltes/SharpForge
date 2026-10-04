import { GitError, checkCancelled, checkLimit } from './errors.js';
import { RemoteManager } from './remotes.js';
import { createHttpTransport, validateRemoteUrl } from './transport/http.js';
import { listRemoteRefs } from './protocol/v2.js';
import { cloneRepository } from './clone.js';
import { fetchRemote } from './fetch.js';
import { pushRemote } from './push.js';
import { scopedWritePermissions } from './auth/context.js';
import { createRepositoryLfsClient } from './adjunct/lfs.js';
import { attachPromisorDatabase, localObjectDatabase, readPromisorDescription } from './adjunct/promisor.js';

const remoteChanges = Object.freeze({
  add: (manager, params, options) => manager.add(params.name, params.url, options),
  remove: (manager, params, options) => manager.remove(params.name, options),
  rename: (manager, params, options) => manager.rename(params.name, params.destination, options),
  setUrl: (manager, params, options) => manager.setUrl(params.name, params.url, { ...options, push: params.push }),
  setUpstream: (manager, params, options) => manager.setUpstream(params.branch, params.name, params.merge, options)
});

function signals(operation, session) {
  const controller = new AbortController();
  const active = [operation, session].filter(Boolean);
  const abort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return { signal: controller.signal, dispose() {
    for (const signal of active) signal.removeEventListener('abort', abort);
  } };
}

export function remoteConnectionSelection(params = {}) {
  const keys = ['remoteName', 'remoteId', 'credentialId', 'proxyUrl', 'credentialForwardOrigins', 'credentialForwardConsent',
    'lfsActionOrigins', 'lfsActionConsent', 'lfsEndpoint', 'anonymous'];
  return Object.fromEntries(keys.filter(key => params[key] !== undefined).map(key => [key, params[key]]));
}

function forceVerifier(remoteId, consent) {
  return async (confirmation, expected) => {
    if (consent?.confirmed !== true || consent.remoteId !== remoteId || consent.scope !== 'push') return false;
    if (confirmation?.confirmed !== true || confirmation.remoteId !== remoteId) return false;
    return ['force-with-lease', 'force-push'].includes(expected.action)
      && ['action', 'ref', 'expected', 'newOid'].every(key => Object.hasOwn(confirmation, key) && confirmation[key] === expected[key]);
  };
}

function networkCredentials(credentials, serviceOptions) {
  if (!serviceOptions.allowInsecureLocalhost) return credentials;
  const localOrigins = new Set((serviceOptions.localOrigins ?? []).map(origin => {
    const url = validateRemoteUrl(origin, { allowInsecureLocalhost: true });
    if (url.protocol !== 'http:' || url.href !== `${url.origin}/`) throw new GitError('Unsafe', 'Local fixture grants must be exact HTTP loopback origins');
    return url.origin;
  }));
  return { ...credentials, requireOrigin: (origin, options) => {
    if (!options.credentials && localOrigins.has(origin)) return true;
    return credentials.requireOrigin(origin, options);
  } };
}

async function remoteOptions(auth, repo, params, context, { push, ...serviceOptions }) {
  if (push && params.anonymous === true) throw new GitError('Auth', 'Anonymous requests cannot push');
  await repo.config.load(context);
  const head = await repo.refs.resolve('HEAD', context);
  const branch = head.ref.startsWith('refs/heads/') ? head.ref.slice(11) : null;
  const remoteName = params.remoteName ?? (branch && repo.config.get(`branch.${branch}.remote`)) ?? 'origin';
  const pushUrl = push ? repo.config.get(`remote.${remoteName}.pushurl`) : undefined;
  const url = validateRemoteUrl(params.url ?? pushUrl ?? repo.config.get(`remote.${remoteName}.url`), serviceOptions).href;
  const remoteId = params.remoteId ?? new URL(url).origin;
  const credentialId = params.anonymous === true ? undefined
    : params.credentialId ?? repo.config.get(`sharpforge.${remoteName}.credentialid`);
  const credentials = await auth.transportOptions({ ...params, remoteId, credentialId,
    actionCredentialOrigins: params.lfsActionOrigins ?? [], actionCredentialConsent: params.lfsActionConsent === true });
  if (push) {
    if (!credentialId) throw new GitError('Auth', 'Select a credential before pushing');
    const credential = await auth.lifecycle.credential(credentialId);
    await scopedWritePermissions({ remoteId, writeConsent: params.writeConsent }).assertWrite(credential, 'push', {
      remote: url, description: 'Push repository references', signal: context.signal
    });
  }
  const transport = createHttpTransport({ ...networkCredentials(credentials, serviceOptions),
    fetch: serviceOptions.fetch ?? globalThis.fetch, proxyUrl: params.proxyUrl,
    allowInsecureLocalhost: serviceOptions.allowInsecureLocalhost === true });
  const linked = signals(context.signal, credentials.sessionSignal);
  const configured = repo.config.getAll(`remote.${remoteName}.fetch`);
  const options = { ...params, odb: repo.odb, refs: repo.refs, config: repo.config, worktree: repo.worktree,
    ...context, url, remoteName, remoteId, credentialId, ref: params.ref ?? head.ref,
    refspecs: params.refspecs ?? (configured.length ? configured : undefined),
    algorithm: repo.algorithm, transport, signal: linked.signal, allowInsecureLocalhost: serviceOptions.allowInsecureLocalhost === true,
    onProgress: value => context.onProgress?.(auth.redactor.value(value)),
    remote: undefined, verifyConfirmation: forceVerifier(remoteId, params.writeConsent) };
  try { if (push) options.lfs = createRepositoryLfsClient(repo, options); }
  catch (error) { linked.dispose(); throw error; }
  return { options, dispose: linked.dispose };
}

/** A service-owned connection registry keeps only selection IDs, never tokens; every lazy request reauthorizes. */
export function createRemoteAccess(auth, serviceOptions = {}) {
  const connections = new WeakMap();
  const prepare = async (repo, params, context, { push = false } = {}) => {
    const prepared = await remoteOptions(auth, repo, params, context, { ...serviceOptions, push });
    const selected = connections.get(repo) ?? new Map();
    try { checkLimit(selected.size + (selected.has(prepared.options.url) ? 0 : 1), 32, 'Repository connection selections'); }
    catch (error) { prepared.dispose(); throw error; }
    selected.set(prepared.options.url, remoteConnectionSelection(prepared.options));
    connections.set(repo, selected);
    return prepared;
  };
  return { prepare, async hydrate({ repository, oids, remote, signal, connection = {} }) {
    const selection = connections.get(repository)?.get(remote.url) ?? remoteConnectionSelection(connection);
    const prepared = await prepare(repository, { ...selection, url: remote.url, wants: oids, refspecs: [],
      haves: [], tags: 'none', filter: undefined, updateRefs: false, writeFetchHead: false }, { signal });
    try { return await fetchRemote({ ...prepared.options, odb: localObjectDatabase(repository.odb) }); }
    finally { prepared.dispose(); }
  } };
}

async function cloneIntoRepository(repo, options, access) {
  const original = repo.odb;
  const originalReaders = [...(localObjectDatabase(original).packs ?? [])];
  if (options.filter) attachPromisorDatabase(repo, { url: options.url, filter: options.filter, algorithm: repo.algorithm }, access.hydrate);
  let result;
  try {
    result = await cloneRepository({ ...options, odb: repo.odb,
      checkout: value => repo.checkout(value.ref ?? value.oid, { signal: options.signal, force: true }) });
  } catch (error) {
    if (options.retainInterrupted !== true) {
      const local = localObjectDatabase(repo.odb);
      if (local !== repo.odb) repo.odb.dispose();
      local.replacePackReaders(originalReaders);
      repo.replaceObjectDatabase(local);
      const description = await readPromisorDescription(repo.store, { allowInsecureLocalhost: options.allowInsecureLocalhost });
      if (description) attachPromisorDatabase(repo, description, access.hydrate);
    }
    // Clone recovery restores persisted metadata; the live session must observe that baseline on retry.
    await repo.config.load();
    await repo.loadIndex();
    await repo.loadRules();
    await repo.refreshShallow();
    throw error;
  }
  await repo.refreshShallow(options);
  return result;
}

async function aheadBehind(repo, params, context) {
  const head = await repo.refs.resolve('HEAD', context);
  const local = params.local ?? head.ref;
  if (!head.oid && params.local === undefined) return null;
  let upstream = params.upstream;
  if (!upstream) {
    if (!local.startsWith('refs/heads/')) return null;
    await repo.config.load(context);
    const branch = local.slice(11);
    const remote = repo.config.get(`branch.${branch}.remote`);
    const merge = repo.config.get(`branch.${branch}.merge`);
    if (!remote || !merge) return null;
    upstream = remote === '.' ? merge : `refs/remotes/${remote}/${merge.replace(/^refs\/heads\//, '')}`;
  }
  return new RemoteManager(repo).aheadBehind(local, upstream, context);
}

/** Network descriptors compose local repositories with explicit origin, credential and write grants. */
export function createRemoteOperations(auth, serviceOptions = {}) {
  const access = serviceOptions.remoteAccess ?? createRemoteAccess(auth, serviceOptions);
  const operation = (name, run, mutates = true) => ({ name, mutates, async run(repo, params, context) {
    const prepared = await access.prepare(repo, params, context, { push: name === 'push' });
    try { checkCancelled(prepared.options.signal); return await run(repo, prepared.options); }
    finally { prepared.dispose(); }
  } });
  return [
    { name: 'head', run: (repo, params, context) => repo.refs.resolve('HEAD', context) },
    { name: 'remotes', async run(repo, params, context) { await repo.config.load(context); return new RemoteManager(repo).list(); } },
    { name: 'changeRemote', mutates: true, run(repo, params, context) {
      if (!Object.hasOwn(remoteChanges, params.action)) throw new GitError('Unsupported', 'Unknown remote edit');
      return remoteChanges[params.action](new RemoteManager(repo), params, context);
    } },
    { name: 'aheadBehind', run: aheadBehind },
    operation('remoteRefs', (repo, options) => listRemoteRefs(options), false),
    operation('fetch', async (repo, options) => {
      if (options.filter === undefined) {
        const description = await readPromisorDescription(repo.store, options);
        if (description?.url === options.url) options = { ...options, filter: description.filter };
      }
      const result = await fetchRemote(options);
      if (options.filter) attachPromisorDatabase(repo, { url: options.url, filter: options.filter, algorithm: repo.algorithm }, access.hydrate);
      await repo.refreshShallow(options);
      return result;
    }),
    operation('push', (repo, options) => pushRemote(options)),
    operation('clone', (repo, options) => cloneIntoRepository(repo, options, access))
  ];
}
