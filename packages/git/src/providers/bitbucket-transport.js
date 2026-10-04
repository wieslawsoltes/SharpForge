import { GitError } from '../errors.js';
import { apiQuery, providerText } from './endpoints.js';
import { sourceMultipart } from './multipart.js';
import { ProviderTransport, branchName, fileChanges, objectId } from './transport.js';

/** Bitbucket Cloud immutable commit/path snapshot reads and parent-bound source commits. */
export class BitbucketTransport extends ProviderTransport {
  async listRefs({ signal } = {}) {
    const [branches, tags] = await Promise.all([
      this.client.paginate(this.path('/refs/branches?pagelen=100'), { signal }),
      this.client.paginate(this.path('/refs/tags?pagelen=100'), { signal })
    ]);
    return [...branches.map(value => ({ name: `refs/heads/${value.name}`, oid: objectId(value.target.hash) })),
      ...tags.map(value => ({ name: `refs/tags/${value.name}`, oid: objectId(value.target.hash) }))];
  }

  async readCommit(oid, { signal } = {}) {
    const value = await this.client.json(this.path(`/commit/${objectId(oid)}`), { signal });
    return { oid: value.hash, treeOid: value.hash, parents: value.parents.map(parent => parent.hash),
      message: value.message, author: { raw: value.author.raw, date: value.date } };
  }

  async readTree(oid, { signal, ref = oid, path = '' } = {}) {
    const route = this.path(`/src/${objectId(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`);
    const values = await this.client.paginate(apiQuery(route, { pagelen: 100 }), { signal });
    return values.map(value => ({ path: value.path, fullPath: true, oid: null,
      type: value.type === 'commit_directory' ? 'tree' : 'blob',
      mode: value.attributes?.includes('link') ? '120000' : value.attributes?.includes('executable') ? '100755' : '100644' }));
  }

  readBlob(oid, { signal, ref, path } = {}) {
    if (!ref || !path) throw new GitError('Unsafe', 'Bitbucket blob reads require an immutable commit and path');
    return this.client.json(this.path(`/src/${objectId(ref)}/${path.split('/').map(encodeURIComponent).join('/')}`), {
      signal, responseType: 'bytes', headers: { Accept: 'application/octet-stream' }
    });
  }

  async createCommit(input, options = {}) {
    if (options.consistency !== 'non-atomic-parent') {
      throw new GitError('Unsupported', 'Bitbucket source commits cannot guarantee atomic branch updates; use smart HTTP', {
        requiredConsistency: 'non-atomic-parent'
      });
    }
    const files = fileChanges(input.files);
    await this.checkHead(input.ref, input.expectedOid, options.signal);
    const message = providerText(input.message);
    const author = input.author ? `${providerText(input.author.name, 'Author')} <${providerText(input.author.email, 'Email')}>` : undefined;
    const { body, contentType } = sourceMultipart(files, { branch: branchName(input.ref), parents: objectId(input.expectedOid), message, author });
    const result = await this.client.json(this.path('/src'), { ...options, method: 'POST', operation: 'push',
      body, headers: { 'Content-Type': contentType } });
    return { oid: objectId(result.hash), parents: result.parents?.map(parent => parent.hash), refUpdated: true, consistency: 'non-atomic-parent' };
  }

  commitFiles(input, options) { return this.createCommit(input, options); }
}
