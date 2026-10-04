import { GitError, checkCancelled, checkLimit } from './errors.js';
import { parseGitConfig } from './config/document.js';
import { validateCheckoutPath } from './path-safety.js';
import { validateRemoteUrl } from './transport/http.js';
import { cloneRepository } from './clone.js';
import { fetchRemote } from './fetch.js';

/** Resolve Git's relative submodule URL against the parent repository path, never the local filesystem. */
export function resolveSubmoduleUrl(value, parentUrl, options = {}) {
  if (typeof value !== 'string' || !value || /[\x00-\x20\x7f]/.test(value)) throw new GitError('Unsafe', 'Submodule URL is invalid');
  const parent = validateRemoteUrl(parentUrl, options);
  if (value.startsWith('./') || value.startsWith('../')) {
    const base = `${parent.href.replace(/\/$/, '')}/`;
    return validateRemoteUrl(new URL(value, base).href, options).href;
  }
  return validateRemoteUrl(value, options).href;
}

/** Parse gitmodule definitions as inert config; includes, shell updates and file transports never execute. */
export function discoverSubmodules(source, { parentUrl, gitlinks = new Map(), maxSubmodules = 1000, ...options } = {}) {
  const text = typeof source === 'string' ? source : new TextDecoder('utf-8', { fatal: true }).decode(source);
  const config = parseGitConfig(text);
  const names = new Set(config.entries().map(entry => /^submodule\.(.+)\.(?:path|url|branch|update)$/.exec(entry.key)?.[1]).filter(Boolean));
  checkLimit(names.size, maxSubmodules, 'Submodule definitions');
  const paths = new Set();
  return [...names].sort().map(name => {
    const path = validateCheckoutPath(config.get(`submodule.${name}.path`));
    const key = path.normalize('NFC').toLowerCase();
    if (paths.has(key)) throw new GitError('Unsafe', 'Submodules have colliding worktree paths');
    paths.add(key);
    const update = config.get(`submodule.${name}.update`, 'checkout');
    if (typeof update !== 'string' || update.startsWith('!')) throw new GitError('Unsafe', 'Submodule shell update commands are forbidden');
    if (!['checkout', 'rebase', 'merge', 'none'].includes(update)) throw new GitError('Unsupported', 'Unknown submodule update strategy');
    const url = resolveSubmoduleUrl(config.get(`submodule.${name}.url`), parentUrl, options);
    const oid = gitlinks instanceof Map ? gitlinks.get(path) : gitlinks[path];
    return { name, path, url, oid: typeof oid === 'object' ? oid.oid : oid ?? null,
      branch: config.get(`submodule.${name}.branch`, null), update, state: 'uninitialized' };
  });
}

/** Trusted hosts may reuse initialized descriptors; checkout returns optional rollback for a failed HEAD CAS. */
export async function initializeSubmodules({ submodules, createRepository, isTrusted, transportForOrigin, checkout,
  signal, onProgress, maxDepth = 8, depth = 0, visited = new Set(), recursive = false, discoverNested }) {
  checkLimit(depth, maxDepth, 'Submodule recursion depth');
  const results = [];
  for (const submodule of submodules) {
    checkCancelled(signal);
    if (!isTrusted || !await isTrusted({ name: submodule.name, path: submodule.path, url: submodule.url, oid: submodule.oid })) {
      results.push({ ...submodule, state: 'uninitialized', reason: 'trust-required' });
      continue;
    }
    if (submodule.update === 'none') { results.push({ ...submodule, state: 'uninitialized', reason: 'update-disabled' }); continue; }
    if (visited.has(submodule.url)) throw new GitError('Unsafe', 'Recursive submodule URL cycle', { url: submodule.url });
    const transport = await transportForOrigin(new URL(submodule.url).origin, submodule);
    const repository = await createRepository(submodule.path, submodule);
    let cloned;
    if (repository.initialized === true) {
      const existing = await repository.refs.read('HEAD', { signal });
      if (!existing) throw new GitError('Conflict', 'Initialized submodule has no HEAD to reuse', { path: submodule.path });
      if ((await repository.odb.read(existing, { signal })).type !== 'commit') {
        throw new GitError('Corrupt', 'Initialized submodule HEAD does not refer to a commit', { path: submodule.path });
      }
      cloned = { oid: existing };
    } else cloned = await cloneRepository({ ...repository, url: submodule.url, transport, signal, onProgress, noCheckout: true });
    const previousHead = await repository.refs.read('HEAD', { deref: false, signal });
    const oid = submodule.oid ?? cloned.oid;
    if (oid && !await repository.odb.has(oid, { signal })) {
      await fetchRemote({ ...repository, url: submodule.url, transport, wants: [oid], updateRefs: false, signal, onProgress });
    }
    if (oid) {
      const applied = await checkout?.({ ...repository, oid, signal, path: submodule.path });
      try {
        await repository.refs.update('HEAD', oid, { signal, deref: false, expected: previousHead, message: 'submodule checkout' });
      } catch (error) {
        try { await applied?.rollback?.(); }
        catch (rollback) {
          throw new GitError('Conflict', 'Submodule HEAD update failed and its worktree could not be restored', {
            path: submodule.path, updateCode: GitError.from(error).code, rollbackCode: GitError.from(rollback).code
          });
        }
        throw error;
      }
    }
    const result = { ...submodule, oid, state: 'initialized' };
    if (recursive && discoverNested) {
      result.children = await initializeSubmodules({ submodules: await discoverNested(repository, submodule),
        createRepository: (path, child) => createRepository(`${submodule.path}/${path}`, child),
        isTrusted, transportForOrigin, checkout, signal, onProgress, maxDepth, depth: depth + 1,
        visited: new Set([...visited, submodule.url]), recursive, discoverNested });
    }
    results.push(result);
  }
  return results;
}
