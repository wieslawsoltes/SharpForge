import { GitError } from '../errors.js';
import { encodeBase64 } from '../auth/security.js';
import { apiQuery, providerText } from './endpoints.js';
import { ProviderTransport, branchName, fileChanges, objectId } from './transport.js';

/** GitLab snapshots and multi-action commits with documented per-file last_commit_id guards. */
export class GitLabTransport extends ProviderTransport {
  async listRefs({ signal } = {}) {
    const [branches, tags] = await Promise.all([
      this.client.paginate(this.path('/repository/branches?per_page=100'), { signal }),
      this.client.paginate(this.path('/repository/tags?per_page=100'), { signal })
    ]);
    return [...branches.map(value => ({ name: `refs/heads/${value.name}`, oid: objectId(value.commit.id) })),
      ...tags.map(value => ({ name: `refs/tags/${value.name}`, oid: objectId(value.commit.id) }))];
  }

  async readCommit(oid, { signal } = {}) {
    const value = await this.client.json(this.path(`/repository/commits/${objectId(oid)}`), { signal });
    return { oid: value.id, treeOid: value.id, parents: value.parent_ids, message: value.message,
      author: { name: value.author_name, email: value.author_email, date: value.authored_date } };
  }

  async readTree(oid, { signal, ref = oid, path = '' } = {}) {
    const values = await this.client.paginate(apiQuery(this.path('/repository/tree'), { ref, path: path.replace(/\/$/, ''), per_page: 100 }), { signal });
    return values.map(value => ({ path: value.path, fullPath: true, oid: objectId(value.id), type: value.type, mode: value.mode }));
  }

  async readBlob(oid, { signal } = {}) {
    return this.client.json(this.path(`/repository/blobs/${objectId(oid)}/raw`), { signal, responseType: 'bytes' });
  }

  async createCommit(input, options = {}) {
    this.requireFileConsistency(options);
    const files = fileChanges(input.files, { modes: ['100644', '100755'] });
    const branch = branchName(input.ref);
    await this.checkHead(input.ref, input.expectedOid, options.signal);
    const actions = [];
    for (const file of files) {
      let existing;
      try {
        existing = await this.client.json(apiQuery(this.path(`/repository/files/${encodeURIComponent(file.path)}`), {
          ref: input.expectedOid
        }), { signal: options.signal });
      } catch (error) { if (error.code !== 'NotFound') throw error; }
      if (file.delete && !existing) throw new GitError('Conflict', 'Deleted file does not exist at the expected commit');
      actions.push({ action: file.delete ? 'delete' : existing ? 'update' : 'create', file_path: file.path,
        content: file.delete ? undefined : encodeBase64(file.content), encoding: 'base64', last_commit_id: existing?.last_commit_id });
      if (!file.delete && (file.mode === '100755' || existing?.execute_filemode)) {
        actions.push({ action: 'chmod', file_path: file.path, execute_filemode: file.mode === '100755' });
      }
    }
    const result = await this.client.json(this.path('/repository/commits'), { ...options, method: 'POST', operation: 'push',
      body: { branch, commit_message: providerText(input.message), actions, author_name: input.author?.name,
        author_email: input.author?.email, force: false } });
    return { oid: objectId(result.id), parents: result.parent_ids, refUpdated: true, consistency: 'file' };
  }

  commitFiles(input, options) { return this.createCommit(input, options); }
}
