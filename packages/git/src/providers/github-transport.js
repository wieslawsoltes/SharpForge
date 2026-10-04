import { GitError, checkLimit } from '../errors.js';
import { decodeBase64, encodeBase64 } from '../auth/security.js';
import { providerText } from './endpoints.js';
import { ProviderTransport, branchName, fileChanges, objectId } from './transport.js';

/** GitHub Git Data snapshots with atomic GraphQL beforeOid reference updates. */
export class GitHubTransport extends ProviderTransport {
  getCapabilities() { return { ...super.getCapabilities(), atomicPush: true, compareAndSwap: true }; }

  async listRefs({ signal } = {}) {
    const refs = await this.client.paginate(this.path('/git/matching-refs/?per_page=100'), { signal });
    return refs.map(value => ({ name: value.ref, oid: objectId(value.object.sha) }));
  }

  async readCommit(oid, { signal } = {}) {
    const value = await this.client.json(this.path(`/git/commits/${objectId(oid)}`), { signal });
    return { oid: value.sha, treeOid: value.tree.sha, parents: value.parents.map(parent => parent.sha),
      author: value.author, committer: value.committer, message: value.message };
  }

  async readTree(oid, { signal } = {}) {
    const result = await this.client.json(this.path(`/git/trees/${objectId(oid)}`), { signal });
    if (result.truncated) throw new GitError('Limit', 'GitHub returned a truncated tree');
    return result.tree.map(value => ({ path: value.path, oid: objectId(value.sha), type: value.type, mode: value.mode }));
  }

  async readBlob(oid, { signal } = {}) {
    const result = await this.client.json(this.path(`/git/blobs/${objectId(oid)}`), { signal });
    if (result.encoding !== 'base64') throw new GitError('Unsupported', 'Unsupported GitHub blob encoding');
    return decodeBase64(result.content, this.client.maximumResponseBytes);
  }

  async createCommit(input, options = {}) {
    const changes = fileChanges(input.files);
    const parent = objectId(input.expectedOid);
    providerText(input.message, 'Commit message');
    await this.checkHead(input.ref, parent, options.signal);
    return this.client.withWrite('push', `Create commit on ${branchName(input.ref)}`, async authorization => {
      const request = { ...options, authorization, operation: 'push' };
      const base = await this.readCommit(parent, request);
      const tree = [];
      for (const file of changes) {
        if (file.delete) { tree.push({ path: file.path, mode: file.mode, type: 'blob', sha: null }); continue; }
        const blob = await this.client.json(this.path('/git/blobs'), { ...request, method: 'POST',
          body: { content: encodeBase64(file.content), encoding: 'base64' } });
        tree.push({ path: file.path, mode: file.mode, type: 'blob', sha: objectId(blob.sha) });
      }
      const createdTree = await this.client.json(this.path('/git/trees'), { ...request, method: 'POST', body: { base_tree: base.treeOid, tree } });
      const commit = await this.client.json(this.path('/git/commits'), { ...request, method: 'POST', body: {
        message: input.message, tree: objectId(createdTree.sha), parents: [parent], author: input.author, committer: input.committer
      } });
      return { oid: objectId(commit.sha), treeOid: createdTree.sha, parents: [parent], refUpdated: false };
    }, options);
  }

  async updateRefs(changes, options = {}) {
    checkLimit(changes.length, 100, 'Reference update count');
    const refUpdates = changes.map(value => ({ name: `refs/heads/${branchName(value.name)}`,
      beforeOid: objectId(value.oldOid), afterOid: objectId(value.newOid), force: false }));
    const repository = await this.client.json(this.path(), { signal: options.signal });
    if (!repository.node_id) throw new GitError('Corrupt', 'GitHub repository node identifier is missing');
    const query = `mutation UpdateRefs($input:UpdateRefsInput!) { updateRefs(input:$input) { clientMutationId } }`;
    const result = await this.client.json('graphql', { ...options, method: 'POST', operation: 'push',
      body: { query, variables: { input: { repositoryId: repository.node_id, refUpdates } } } });
    if (result.errors?.length || !result.data?.updateRefs) throw new GitError('Conflict', 'GitHub reference compare-and-swap failed');
    return changes.map(value => ({ name: value.name, ok: true }));
  }

  async commitFiles(input, options = {}) {
    const commit = await this.createCommit(input, options);
    await this.updateRef({ name: input.ref, oldOid: input.expectedOid, newOid: commit.oid }, options);
    return { ...commit, refUpdated: true };
  }
}
