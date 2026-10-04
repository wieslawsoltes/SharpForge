import { GitError, checkLimit } from './errors.js';
import { decodeCommit, decodeTag, decodeTree } from './objects.js';

async function resolveName(repo, name, options) {
  if (!name || name === '@') name = 'HEAD';
  const hashLength = repo.algorithm === 'sha256' ? 64 : 40;
  if (new RegExp(`^[a-fA-F0-9]{${hashLength}}$`, 'u').test(name)) {
    const oid = name.toLowerCase();
    await repo.odb.read(oid, options);
    return oid;
  }
  const candidates = [name, `refs/${name}`, `refs/tags/${name}`, `refs/heads/${name}`, `refs/remotes/${name}`, `refs/remotes/${name}/HEAD`];
  const found = new Set();
  for (const candidate of candidates) {
    try {
      const oid = await repo.refs.read(candidate, options);
      if (oid) found.add(oid);
    } catch (error) {
      if (!['NotFound', 'Unsafe'].includes(error.code)) throw error;
    }
  }
  if (found.size > 1) throw new GitError('Conflict', 'Ambiguous revision name', { name });
  if (found.size) return found.values().next().value;
  if (/^[a-fA-F0-9]{4,63}$/u.test(name)) {
    const ids = await repo.odb.list();
    const matching = ids.map(value => typeof value === 'string' ? value : value.oid).filter(oid => oid.startsWith(name.toLowerCase()));
    if (matching.length === 1) return matching[0];
    if (matching.length > 1) throw new GitError('Conflict', 'Ambiguous abbreviated object id', { name });
  }
  throw new GitError('NotFound', 'Unknown revision', { name });
}

export async function peelRevision(repo, oid, target = 'commit', options = {}) {
  for (let depth = 0; depth < 128; depth++) {
    const object = await repo.odb.read(oid, options);
    if (object.type === target || target === 'object') return oid;
    if (object.type === 'tag') {
      oid = decodeTag(object.data, { algorithm: repo.algorithm }).object;
      continue;
    }
    if (target === '') return oid;
    if (object.type === 'commit' && target === 'tree') return decodeCommit(object.data, { algorithm: repo.algorithm }).tree;
    throw new GitError('Corrupt', 'Revision has the wrong object type', { oid, actual: object.type, expected: target });
  }
  throw new GitError('Limit', 'Tag peeling exceeds its depth limit');
}

async function upstream(repo, branch, suffix) {
  if (!branch || branch === 'HEAD' || branch === '@') {
    const head = await repo.refs.resolve('HEAD');
    if (!head.ref.startsWith('refs/heads/')) throw new GitError('Conflict', 'Detached HEAD has no upstream branch');
    branch = head.ref.slice(11);
  }
  branch = branch.replace(/^refs\/heads\//u, '');
  const remote = repo.config?.get(`branch.${branch}.remote`);
  const merge = repo.config?.get(`branch.${branch}.merge`);
  if (!remote || !merge) throw new GitError('NotFound', 'Branch has no configured upstream', { branch });
  if (suffix === 'push') {
    const pushRemote = repo.config?.get(`branch.${branch}.pushRemote`) ?? remote;
    return pushRemote === '.' ? merge : `refs/remotes/${pushRemote}/${merge.replace(/^refs\/heads\//u, '')}`;
  }
  return remote === '.' ? merge : `refs/remotes/${remote}/${merge.replace(/^refs\/heads\//u, '')}`;
}

async function resolveReflog(repo, name, selector, options) {
  if (['upstream', 'u', 'push'].includes(selector)) return resolveName(repo, await upstream(repo, name, selector), options);
  if (!/^\d+$/u.test(selector)) throw new GitError('Unsupported', 'Only numbered reflog selectors are supported', { selector });
  let ref = !name || name === '@' || name === 'HEAD' ? 'HEAD' : name;
  if (ref !== 'HEAD' && !ref.startsWith('refs/')) {
    const candidates = [`refs/heads/${name}`, `refs/remotes/${name}`, `refs/tags/${name}`];
    ref = null;
    for (const candidate of candidates) {
      if (await repo.refs.read(candidate)) { ref = candidate; break; }
    }
    if (!ref) throw new GitError('NotFound', 'Reflog revision has no matching ref', { name });
  }
  const log = await repo.refs.reflog(ref);
  const record = log[log.length - 1 - Number(selector)];
  if (!record) throw new GitError('NotFound', 'Reflog entry does not exist', { ref, selector });
  return record.newOid ?? record.new ?? record.oid;
}

async function resolvePath(repo, oid, path, options) {
  oid = await peelRevision(repo, oid, 'tree', options);
  if (!path) return oid;
  const parts = path.split('/');
  checkLimit(parts.length, 512, 'Revision path depth');
  for (let index = 0; index < parts.length; index++) {
    const object = await repo.odb.read(oid, options);
    if (object.type !== 'tree') throw new GitError('NotFound', 'Revision path crosses a non-directory', { path });
    const entry = decodeTree(object.data, { algorithm: repo.algorithm }).find(item => item.name === parts[index]);
    if (!entry) throw new GitError('NotFound', 'Path does not exist in the revision', { path });
    oid = entry.oid;
  }
  return oid;
}

async function scalarRevision(repo, expression, options) {
  const separator = expression.indexOf(':');
  const path = separator >= 0 ? expression.slice(separator + 1) : null;
  let syntax = separator >= 0 ? expression.slice(0, separator) : expression;
  const match = /^(@(?!\{)|[^~^@]*)(?:@\{([^}]+)\})?/u.exec(syntax);
  const name = match[1];
  let oid = match[2] !== undefined ? await resolveReflog(repo, name, match[2], options) : await resolveName(repo, name, options);
  syntax = syntax.slice(match[0].length);
  let operations = 0;
  while (syntax) {
    checkLimit(++operations, 1024, 'Revision suffix operations');
    const suffix = /^(?:\^\{(tree|commit|tag|blob|object|)\}|([~^])(\d*))/u.exec(syntax);
    if (!suffix) throw new GitError('Corrupt', 'Invalid revision suffix', { expression, suffix: syntax });
    if (suffix[1] !== undefined) oid = await peelRevision(repo, oid, suffix[1], options);
    else {
      const count = suffix[3] === '' ? 1 : Number(suffix[3]);
      checkLimit(count, 1000000, 'Revision ancestor count');
      oid = await peelRevision(repo, oid, 'commit', options);
      const steps = suffix[2] === '~' ? count : 1;
      for (let index = 0; index < steps; index++) {
        const commit = await repo.readCommit(oid, options);
        if (!count) continue;
        const parents = repo.graph?.parents(commit, options) ?? commit.parents;
        oid = parents[suffix[2] === '~' ? 0 : count - 1];
        if (!oid) throw new GitError('NotFound', 'Revision parent does not exist', { expression });
      }
    }
    syntax = syntax.slice(suffix[0].length);
  }
  return path === null ? oid : resolvePath(repo, oid, path, options);
}

/** Resolve scalar Git revisions to an oid, or ranges to explicit include/exclude sets. */
export async function revParse(repo, expression = 'HEAD', options = {}) {
  checkLimit(expression.length, 32768, 'Revision expression');
  if (repo.graph?.context) options = await repo.graph.context(options);
  const indexPath = /^:(?:([0-3]):)?(.+)$/u.exec(expression);
  if (indexPath) {
    const entry = repo.index.get(indexPath[2], Number(indexPath[1] ?? 0));
    if (!entry) throw new GitError('NotFound', 'Path is absent from the requested index stage', { expression });
    return entry.oid;
  }
  const range = expression.includes(':') ? null : /^(.*?)\.(\.\.?)(.*?)$/u.exec(expression);
  if (range) {
    const before = await scalarRevision(repo, range[1] || 'HEAD', options);
    const after = await scalarRevision(repo, range[3] || 'HEAD', options);
    const symmetric = range[2] === '..';
    const exclude = symmetric ? await repo.graph.mergeBases(await peelRevision(repo, before, 'commit', options),
      await peelRevision(repo, after, 'commit', options), options) : [before];
    return { include: symmetric ? [before, after] : [after],
      exclude, symmetric };
  }
  const set = /^(.*)\^(!|@|-(\d*))$/u.exec(expression);
  if (set) {
    const oid = await scalarRevision(repo, set[1], options);
    const commit = await repo.readCommit(await peelRevision(repo, oid, 'commit', options), options);
    const parents = repo.graph?.parents(commit, options) ?? commit.parents;
    if (set[2] === '@') return { include: parents, exclude: [], symmetric: false };
    const exclude = set[2] === '!' ? parents : [parents[Number(set[3] || 1) - 1]];
    if (exclude.some(value => !value)) throw new GitError('NotFound', 'Revision parent does not exist', { expression });
    return { include: [oid], exclude, symmetric: false };
  }
  if (expression.startsWith('^')) return { include: [], exclude: [await scalarRevision(repo, expression.slice(1), options)], symmetric: false };
  return scalarRevision(repo, expression, options);
}

export const resolveRevision = revParse;
