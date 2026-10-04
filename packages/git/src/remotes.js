import { GitError } from './errors.js';
import { GitConfig } from './config.js';
import { RefDatabase } from './refs.js';
import { validateRefName } from './refs/names.js';
import { validateRemoteUrl } from './transport/http.js';
import { collectAncestors } from './remote-graph.js';
import { parseShallow } from './shallow.js';

function remoteName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.endsWith('.lock')) {
    throw new GitError('Unsafe', 'Remote name is invalid');
  }
  return name;
}

function transactionalView(transaction) {
  const view = {
    get: (...args) => transaction.get(...args), set: (...args) => transaction.set(...args),
    delete: (...args) => transaction.delete(...args), list: (...args) => transaction.list(...args)
  };
  view.transaction = operation => operation(view);
  return view;
}

/** Remote config and tracking refs are committed in the same underlying store transaction. */
export class RemoteManager {
  constructor({ config, refs, odb, algorithm = 'sha1', allowInsecureLocalhost = false }) {
    this.config = config;
    this.refs = refs;
    this.odb = odb;
    this.algorithm = algorithm;
    this.allowInsecureLocalhost = allowInsecureLocalhost;
  }

  list() {
    const names = new Set(this.config.entries().map(entry => /^remote\.(.+)\.(?:url|fetch|pushurl)$/.exec(entry.key)?.[1]).filter(Boolean));
    return [...names].sort().map(name => ({ name, url: this.config.get(`remote.${name}.url`),
      pushUrl: this.config.get(`remote.${name}.pushurl`), fetch: this.config.getAll(`remote.${name}.fetch`) }));
  }

  async edit(operation, { signal } = {}) {
    if (this.config.store !== this.refs.store) throw new GitError('Unsupported', 'Atomic remote editing requires one shared store');
    const result = await this.config.store.transaction(async transaction => {
      const store = transactionalView(transaction);
      const config = new GitConfig({ store, path: this.config.path });
      await config.load({ signal });
      const refs = new RefDatabase({ store, algorithm: this.algorithm });
      const value = await operation(config, refs);
      await config.save({ signal });
      return value;
    }, { signal });
    await this.config.load({ signal });
    return result;
  }

  async add(name, url, options = {}) {
    remoteName(name);
    validateRemoteUrl(url, this);
    return this.edit(async config => {
      if (config.has(`remote.${name}.url`)) throw new GitError('Conflict', 'Remote already exists', { name });
      config.set(`remote.${name}.url`, url);
      config.set(`remote.${name}.fetch`, `+refs/heads/*:refs/remotes/${name}/*`);
      return { name, url };
    }, options);
  }

  async setUrl(name, url, { push = false, ...options } = {}) {
    remoteName(name);
    validateRemoteUrl(url, this);
    return this.edit(async config => {
      if (!config.has(`remote.${name}.url`)) throw new GitError('NotFound', 'Remote does not exist', { name });
      config.set(`remote.${name}.${push ? 'pushurl' : 'url'}`, url);
      return { name, url };
    }, options);
  }

  async remove(name, options = {}) {
    remoteName(name);
    return this.edit(async (config, refs) => {
      if (!config.has(`remote.${name}.url`)) throw new GitError('NotFound', 'Remote does not exist', { name });
      for (const entry of config.entries()) {
        if (entry.key.startsWith(`remote.${name}.`)) config.unset(entry.key);
        if (entry.key.startsWith('branch.') && entry.key.endsWith('.remote') && entry.value === name) {
          config.unset(entry.key);
          config.unset(entry.key.slice(0, -6) + 'merge');
        }
      }
      const tracking = await refs.list(`refs/remotes/${name}/`, options);
      await refs.transaction(tracking.map(ref => ({ name: ref.name, oid: null,
        expected: ref.symbolic ?? ref.oid, deref: false, message: 'remote remove' })), options);
      return { removed: name, refs: tracking.length };
    }, options);
  }

  async rename(name, destination, options = {}) {
    remoteName(name);
    remoteName(destination);
    return this.edit(async (config, refs) => {
      if (!config.has(`remote.${name}.url`)) throw new GitError('NotFound', 'Remote does not exist', { name });
      if (config.has(`remote.${destination}.url`)) throw new GitError('Conflict', 'Destination remote already exists');
      const entries = config.entries();
      for (const entry of entries) if (entry.key.startsWith(`remote.${name}.`)) {
        const key = `remote.${destination}.${entry.key.slice(name.length + 8)}`;
        const value = typeof entry.value === 'string' ? entry.value.replace(`refs/remotes/${name}/`, `refs/remotes/${destination}/`) : entry.value;
        config.set(key, value, { append: true });
        config.unset(entry.key);
      }
      for (const entry of entries) if (entry.key.startsWith('branch.') && entry.key.endsWith('.remote') && entry.value === name) {
        config.set(entry.key, destination);
      }
      const tracking = await refs.list(`refs/remotes/${name}/`, options);
      const changes = [];
      for (const ref of tracking) {
        changes.push({ name: ref.name, oid: null, expected: ref.symbolic ?? ref.oid, deref: false, message: 'remote rename' });
        if (!ref.symbolic) changes.push({ name: ref.name.replace(`/${name}/`, `/${destination}/`), oid: ref.oid, expected: null, message: 'remote rename' });
      }
      await refs.transaction(changes, options);
      for (const ref of tracking.filter(item => item.symbolic)) {
        await refs.setSymbolic(ref.name.replace(`/${name}/`, `/${destination}/`),
          ref.symbolic.replace(`/${name}/`, `/${destination}/`), { ...options, expected: null });
      }
      return { name: destination, previous: name };
    }, options);
  }

  async setUpstream(branch, remote, merge, options = {}) {
    remoteName(remote);
    const branchRef = branch.startsWith('refs/heads/') ? branch : `refs/heads/${branch}`;
    const mergeRef = merge.startsWith('refs/heads/') ? merge : `refs/heads/${merge}`;
    validateRefName(branchRef);
    validateRefName(mergeRef);
    return this.edit(async config => {
      if (!config.has(`remote.${remote}.url`)) throw new GitError('NotFound', 'Upstream remote does not exist');
      config.set(`branch.${branchRef.slice(11)}.remote`, remote);
      config.set(`branch.${branchRef.slice(11)}.merge`, mergeRef);
      return { branch: branchRef, remote, merge: mergeRef };
    }, options);
  }

  async aheadBehind(local, upstream, options = {}) {
    const localOid = await this.refs.read(local, options);
    const upstreamOid = await this.refs.read(upstream, options);
    if (!localOid || !upstreamOid) throw new GitError('NotFound', 'Ahead/behind requires two existing references');
    const shallow = parseShallow(await this.odb.store?.get('shallow', options), { algorithm: this.algorithm });
    for (const oid of options.shallow ?? []) shallow.add(oid);
    const args = { odb: this.odb, algorithm: this.algorithm, ...options, shallow };
    const [left, right] = await Promise.all([
      collectAncestors({ ...args, tips: [localOid] }), collectAncestors({ ...args, tips: [upstreamOid] })
    ]);
    return { ahead: [...left].filter(oid => !right.has(oid)).length, behind: [...right].filter(oid => !left.has(oid)).length };
  }
}
