import { GitError, checkLimit } from '../errors.js';
import { encodeBase64 } from '../auth/security.js';
import { apiQuery, providerText } from './endpoints.js';
import { ProviderTransport, branchName, fileChanges, objectId } from './transport.js';

/** Azure DevOps Git snapshots with oldObjectId compare-and-swap for each reference. */
export class AzureDevOpsTransport extends ProviderTransport {
  getCapabilities() { return { ...super.getCapabilities(), compareAndSwap: true }; }
  api(suffix, query = {}) { return apiQuery(this.path(suffix), { 'api-version': '7.1', ...query }); }

  async listRefs({ signal } = {}) {
    return (await this.client.paginate(this.api('/refs', { $top: 1000 }), { signal }))
      .map(value => ({ name: value.name, oid: objectId(value.objectId) }));
  }

  async readCommit(oid, { signal } = {}) {
    const value = await this.client.json(this.api(`/commits/${objectId(oid)}`), { signal });
    return { oid: value.commitId, treeOid: value.treeId, parents: value.parents, author: value.author,
      committer: value.committer, message: value.comment };
  }

  async readTree(oid, { signal } = {}) {
    const tree = await this.client.json(this.api(`/trees/${objectId(oid)}`, { recursive: false }), { signal });
    if (tree.truncated) throw new GitError('Limit', 'Azure DevOps returned a truncated tree');
    return tree.treeEntries.map(value => ({ path: value.relativePath, oid: objectId(value.objectId),
      type: value.gitObjectType, mode: String(value.mode ?? '100644') }));
  }

  readBlob(oid, { signal } = {}) {
    return this.client.json(this.api(`/blobs/${objectId(oid)}`, { '$format': 'octetStream' }), {
      signal, responseType: 'bytes', headers: { Accept: 'application/octet-stream' }
    });
  }

  async createCommit(input, options = {}) {
    const files = fileChanges(input.files, { modes: ['100644'] });
    const ref = `refs/heads/${branchName(input.ref)}`;
    const oldObjectId = objectId(input.expectedOid);
    const changes = [];
    for (const file of files) {
      let exists = Boolean(file.previousOid);
      if (!exists && !file.delete) {
        try {
          await this.client.json(this.api('/items', { path: `/${file.path}`, 'versionDescriptor.version': oldObjectId,
            'versionDescriptor.versionType': 'commit' }), { signal: options.signal });
          exists = true;
        } catch (error) { if (error.code !== 'NotFound') throw error; }
      }
      changes.push({ changeType: file.delete ? 'delete' : exists ? 'edit' : 'add', item: { path: `/${file.path}` },
        newContent: file.delete ? undefined : { content: encodeBase64(file.content), contentType: 'base64encoded' } });
    }
    const result = await this.client.json(this.api('/pushes'), { ...options, method: 'POST', operation: 'push', body: {
      refUpdates: [{ name: ref, oldObjectId }], commits: [{ comment: providerText(input.message),
        author: input.author, committer: input.committer, changes }]
    } });
    const commit = result.commits?.[0];
    if (!commit) throw new GitError('Corrupt', 'Azure push response omitted the commit');
    return { oid: objectId(commit.commitId), treeOid: commit.treeId, parents: commit.parents, refUpdated: true };
  }

  async updateRefs(changes, { atomic = false, ...options } = {}) {
    checkLimit(changes.length, 100, 'Reference update count');
    if (atomic && changes.length > 1) throw new GitError('Unsupported', 'Azure API does not provide multi-ref atomic transactions');
    const body = changes.map(value => ({ name: `refs/heads/${branchName(value.name)}`,
      oldObjectId: objectId(value.oldOid), newObjectId: objectId(value.newOid) }));
    const result = await this.client.json(this.api('/refs'), { ...options, method: 'POST', body, operation: 'push' });
    const updates = result.value ?? [];
    if (updates.length !== changes.length) throw new GitError('Corrupt', 'Azure ref update response is incomplete');
    return updates.map(value => ({ name: value.name, ok: value.success === true,
      message: value.success ? undefined : String(value.updateStatus ?? 'Reference update rejected') }));
  }

  commitFiles(input, options) { return this.createCommit(input, options); }
}
