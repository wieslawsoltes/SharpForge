import { GitError, checkLimit } from '../errors.js';
import { discoverSubmodules, initializeSubmodules } from '../submodules.js';
import { planCheckout, applyCheckout } from '../checkout.js';
import { inspectSubmoduleRepository } from './nested.js';

/** Read inert .gitmodules definitions and match them to actual pinned gitlink entries. */
export async function repositorySubmodules(repo, options = {}) {
  const tree = await repo.readTree(options.revision ?? 'HEAD', options);
  let source;
  if (options.revision) {
    const entry = tree.get('.gitmodules');
    if (entry) source = { ...(await repo.odb.read(entry.oid, options)), mode: entry.mode };
  } else source = await repo.worktree.read('.gitmodules', options);
  if (!source) return [];
  if (source.mode !== 0o100644 && source.mode !== 0o100755) throw new GitError('Unsafe', '.gitmodules must be a regular file');
  const parentUrl = options.parentUrl ?? repo.config.get(`remote.${options.remoteName ?? 'origin'}.url`);
  if (!parentUrl) throw new GitError('NotFound', 'Submodule URL resolution requires a parent remote');
  const gitlinks = new Map([...tree].filter(([, entry]) => entry.mode === 0o160000));
  const modules = discoverSubmodules(source.data, { ...options, parentUrl, gitlinks });
  const result = [];
  for (const module of modules) result.push({ ...module, ...await inspectSubmoduleRepository(repo, module, options) });
  return result;
}

/** Nested storage uses an explicit factory; request-local URL/path/pin trust never substitutes for origin grants. */
export async function initializeRepositorySubmodules(repo, params, context, capabilities) {
  if (params.recursive) throw new GitError('Unsupported', 'Recursive submodule initialization needs a host-specific nested trust workflow');
  const modules = await repositorySubmodules(repo, { ...params, ...context });
  if (params.paths !== undefined && !Array.isArray(params.paths)) throw new GitError('Unsafe', 'Submodule paths must be an array');
  checkLimit(params.paths?.length ?? 0, 1000, 'Selected submodules');
  const selected = params.paths ? new Set(params.paths) : null;
  const known = new Set(modules.map(module => module.path));
  if (selected && [...selected].some(path => !known.has(path))) {
    throw new GitError('NotFound', 'A requested submodule is not defined');
  }
  if (params.trustedSubmodules !== undefined && !Array.isArray(params.trustedSubmodules)) {
    throw new GitError('Unsafe', 'Submodule trust records must be an array');
  }
  checkLimit(params.trustedSubmodules?.length ?? 0, 1000, 'Submodule trust records');
  const trusted = new Map((params.trustedSubmodules ?? []).map(grant => [JSON.stringify([grant.path, grant.url]), grant]));
  const opened = [];
  try {
    const result = await initializeSubmodules({
      submodules: modules.filter(module => module.oid && (!selected || selected.has(module.path))), ...context,
      isTrusted: module => {
        const grant = trusted.get(JSON.stringify([module.path, module.url]));
        return !!grant && (grant.oid === undefined || grant.oid === module.oid);
      },
      createRepository: async (path, module) => {
        if (!capabilities.createRepository) throw new GitError('Unsupported', 'The host has no nested repository storage adapter');
        const value = await capabilities.createRepository({ parent: repo, path, module, signal: context.signal });
        opened.push(value);
        return value.repository ? { ...value.repository, initialized: value.initialized === true } : value;
      },
      transportForOrigin: (origin, module) => capabilities.transportFor(module, { ...params, ...context }),
      checkout: async ({ worktree, oid, path }) => {
        const value = opened.find(item => (item.repository ?? item).worktree === worktree);
        const nested = value?.repository ?? value;
        if (typeof nested?.checkout !== 'function') throw new GitError('Unsupported', 'Nested repository cannot materialize its pinned commit', { path });
        const options = { ...context, force: value.initialized !== true || params.force === true };
        const plan = await planCheckout(nested, oid, options);
        const snapshot = await applyCheckout(nested, plan, options);
        return { rollback: () => nested.restoreSnapshot(snapshot) };
      }
    });
    const initialized = result.filter(module => module.state === 'initialized');
    if (initialized.length) {
      await repo.config.load(context);
      for (const module of initialized) {
        repo.config.set('submodule.' + module.name + '.url', module.url);
        repo.config.set('submodule.' + module.name + '.active', true);
      }
      await repo.config.save(context);
    }
    return [...result, ...modules.filter(module => !module.oid && (!selected || selected.has(module.path))).map(module => ({
      ...module, reason: 'missing-gitlink'
    }))];
  } finally {
    for (const value of opened.reverse()) {
      if (value.dispose) await value.dispose();
      else { await value.repository?.dispose?.(); await value.store?.close?.(); }
      if (value.store && value.dispose) await value.store.close?.();
    }
  }
}
