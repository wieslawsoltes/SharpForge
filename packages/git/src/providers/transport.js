import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { providerText } from './endpoints.js';

/** A transport path is always repository-relative and cannot escape through encoded or literal traversal. */
export function repositoryPath(value) {
  providerText(value, 'Repository path', 4096);
  if (!value || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f]/.test(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    throw new GitError('Unsafe', 'Unsafe repository-relative path');
  }
  return value;
}

export function branchName(value) {
  providerText(value, 'Branch name', 1024);
  const branch = value.startsWith('refs/heads/') ? value.slice(11) : value;
  if (!branch || branch.startsWith('-') || branch.includes('..') || /[\s~^:?*\[\\]/.test(branch) ||
      branch.includes('@{') || branch.endsWith('.') || branch.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))) {
    throw new GitError('Unsafe', 'Invalid branch reference');
  }
  return branch;
}

export function objectId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw new GitError('Corrupt', 'Expected a SHA-1 Git object identifier');
  return value;
}

export function fileChanges(input, { modes = ['100644', '100755', '120000'] } = {}) {
  if (!Array.isArray(input)) throw new GitError('Unsafe', 'File change list is required');
  checkLimit(input.length, 10000, 'Commit file count');
  const paths = new Set();
  let total = 0;
  return input.map(file => {
    const path = repositoryPath(file.path);
    if (paths.has(path)) throw new GitError('Conflict', 'Commit contains duplicate file paths');
    paths.add(path);
    const mode = String(file.mode ?? '100644');
    if (!modes.includes(mode)) throw new GitError('Unsupported', 'Provider cannot preserve this Git file mode', { mode });
    const content = file.delete ? null : typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content;
    if (!file.delete && !(content instanceof Uint8Array)) throw new GitError('Unsafe', 'File content must be UTF-8 text or bytes');
    total += content?.byteLength ?? 0;
    checkLimit(total, 32 * 1024 * 1024, 'Commit content bytes');
    return { ...file, path, content, mode };
  });
}

/** Snapshot transport base. Metadata-only provider APIs do not claim exact canonical commit-byte support. */
export class ProviderTransport {
  constructor({ client, endpoint }) { this.client = client; this.endpoint = endpoint; }
  path(suffix = '') { return `${this.endpoint.repoPath}${suffix}`; }
  getCapabilities() {
    return { canonicalObjects: false, atomicPush: false, objectFormat: 'sha1', snapshot: true, compareAndSwap: false };
  }
  getObject() { throw new GitError('Unsupported', 'Provider REST metadata does not preserve canonical Git object bytes'); }
  writeObject() { throw new GitError('Unsupported', 'Provider REST API cannot upload an arbitrary canonical object'); }
  updateRefs() { throw new GitError('Unsupported', 'Provider does not expose atomic compare-and-swap reference updates'); }
  updateRef(change, options) { return this.updateRefs([change], options); }

  async readSnapshot({ ref = 'refs/heads/main', signal, maximumFiles = 10000, maximumBytes = 64 * 1024 * 1024 } = {}) {
    checkLimit(maximumFiles, 100000, 'Snapshot file limit');
    checkLimit(maximumBytes, 64 * 1024 * 1024, 'Snapshot byte limit');
    checkCancelled(signal);
    const references = await this.listRefs({ signal });
    const reference = references.find(value => value.name === ref || value.name === `refs/heads/${ref}`);
    if (!reference) throw new GitError('NotFound', 'Remote branch not found', { ref });
    const commit = await this.readCommit(reference.oid, { signal });
    const stack = [{ oid: commit.treeOid ?? reference.oid, prefix: '', depth: 0 }];
    const files = [];
    const paths = new Set();
    let size = 0;
    let trees = 0;
    while (stack.length) {
      checkCancelled(signal);
      const current = stack.pop();
      checkLimit(++trees, maximumFiles, 'Snapshot tree count');
      checkLimit(current.depth, 128, 'Snapshot tree depth');
      const entries = await this.readTree(current.oid, { signal, ref: reference.oid, path: current.prefix });
      for (const entry of entries) {
        const path = repositoryPath(entry.fullPath ? entry.path : `${current.prefix}${entry.path}`);
        if (paths.has(path)) throw new GitError('Corrupt', 'Snapshot contains a duplicate path', { path });
        paths.add(path);
        if (entry.type === 'tree') {
          checkLimit(trees + stack.length + 1, maximumFiles, 'Snapshot tree count');
          stack.push({ oid: entry.oid, prefix: `${path}/`, depth: current.depth + 1 });
          continue;
        }
        if (entry.type === 'commit' || entry.mode === '160000') throw new GitError('Unsupported', 'Snapshot contains a submodule', { path });
        if (entry.type !== 'blob') throw new GitError('Corrupt', 'Unknown snapshot object type');
        checkLimit(files.length + 1, maximumFiles, 'Snapshot file count');
        const content = await this.readBlob(entry.oid, { signal, path, ref: reference.oid });
        size += content.byteLength;
        checkLimit(size, maximumBytes, 'Snapshot content bytes');
        files.push({ path, oid: entry.oid ?? null, mode: entry.mode ?? '100644', content });
      }
    }
    return { ref: reference.name, oid: reference.oid, commit, files: files.sort((left, right) => left.path.localeCompare(right.path)) };
  }

  async checkHead(ref, expectedOid, signal) {
    const name = `refs/heads/${branchName(ref)}`;
    objectId(expectedOid);
    this.client.clearCache();
    const actual = (await this.listRefs({ signal })).find(value => value.name === name)?.oid;
    if (actual !== expectedOid) throw new GitError('Conflict', 'Remote branch changed', { ref: name, expectedOid, actualOid: actual ?? null });
    return name;
  }

  requireFileConsistency(options) {
    if (options.consistency !== 'file') {
      throw new GitError('Unsupported', 'This provider exposes file-level conflict checks, not atomic branch compare-and-swap', {
        provider: this.endpoint.provider, requiredConsistency: 'file', alternative: 'smart-http'
      });
    }
  }
}
