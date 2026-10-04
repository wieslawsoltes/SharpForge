import { GitError } from '../errors.js';
import { decodeBase64, encodeBase64 } from '../auth/security.js';
import { apiQuery, providerText } from './endpoints.js';
import { ProviderTransport, branchName, fileChanges, objectId } from './transport.js';

/** Gitea trees/blobs and contents multi-file commits with per-file SHA conflict checks. */
export class GiteaTransport extends ProviderTransport {
  async listRefs({ signal } = {}) {
    const values = await this.client.paginate(this.path('/git/refs?limit=50'), { signal });
    return values.map(value => ({ name: value.ref, oid: objectId(value.object.sha) }));
  }

  async readCommit(oid, { signal } = {}) {
    const value = await this.client.json(this.path(`/git/commits/${objectId(oid)}`), { signal });
    const commit = value.commit ?? value;
    return { oid: value.sha ?? commit.sha, treeOid: commit.tree.sha, parents: value.parents.map(parent => parent.sha),
      author: commit.author, committer: commit.committer, message: commit.message };
  }

  async readTree(oid, { signal } = {}) {
    const values = await this.client.paginate(this.path(`/git/trees/${objectId(oid)}?per_page=100`), {
      signal, select: result => {
        if (result.truncated) throw new GitError('Limit', 'Gitea returned a truncated tree');
        return result.tree;
      }
    });
    return values.map(value => ({ path: value.path, oid: objectId(value.sha), type: value.type, mode: value.mode }));
  }

  async readBlob(oid, { signal } = {}) {
    const result = await this.client.json(this.path(`/git/blobs/${objectId(oid)}`), { signal });
    if (result.encoding !== 'base64') throw new GitError('Unsupported', 'Unsupported Gitea blob encoding');
    return decodeBase64(result.content, this.client.maximumResponseBytes);
  }

  async createCommit(input, options = {}) {
    this.requireFileConsistency(options);
    const changes = fileChanges(input.files, { modes: ['100644'] });
    await this.checkHead(input.ref, input.expectedOid, options.signal);
    const files = [];
    for (const file of changes) {
      let existing;
      try {
        existing = await this.client.json(apiQuery(this.path(`/contents/${file.path.split('/').map(encodeURIComponent).join('/')}`), {
          ref: input.expectedOid
        }), { signal: options.signal });
      } catch (error) { if (error.code !== 'NotFound') throw error; }
      if (file.delete && !existing) throw new GitError('Conflict', 'Deleted file is missing at the expected commit');
      files.push({ operation: file.delete ? 'delete' : existing ? 'update' : 'create', path: file.path,
        sha: existing?.sha, content: file.delete ? undefined : encodeBase64(file.content) });
    }
    const result = await this.client.json(this.path('/contents'), { ...options, method: 'POST', operation: 'push', body: {
      branch: branchName(input.ref), message: providerText(input.message), author: input.author,
      committer: input.committer, files, force_push: false
    } });
    return { oid: objectId(result.commit.sha), treeOid: result.commit.tree?.sha, refUpdated: true, consistency: 'file' };
  }

  commitFiles(input, options) { return this.createCommit(input, options); }
}
