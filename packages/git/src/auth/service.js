import { GitError, checkCancelled } from '../errors.js';
import { createGitProvider, createProviderTransport } from '../providers/index.js';
import { providerNumber } from '../providers/endpoints.js';

const providerCalls = Object.freeze({
  listIssues: (provider, input, options) => provider.listIssues({ ...input, signal: options.signal }),
  listPullRequests: (provider, input, options) => provider.listPullRequests({ ...input, signal: options.signal }),
  getPullRequest: (provider, input, options) => provider.getPullRequest(providerNumber(input.number), options),
  createIssue: (provider, input, options) => provider.createIssue(input, options),
  createPullRequest: (provider, input, options) => provider.createPullRequest(input, options),
  updateIssue: (provider, input, options) => provider.updateIssue(providerNumber(input.number), input, options),
  updatePullRequest: (provider, input, options) => provider.updatePullRequest(providerNumber(input.number), input, options),
  listComments: (provider, input, options) => provider.listComments(providerNumber(input.number), { ...options, kind: input.kind }),
  listReviewThreads: (provider, input, options) => provider.listReviewThreads(providerNumber(input.number), options),
  addComment: (provider, input, options) => provider.addComment(providerNumber(input.number), input.body, { ...options, kind: input.kind }),
  createReview: (provider, input, options) => provider.createReview(providerNumber(input.number), input, options),
  listChecks: (provider, input, options) => provider.listChecks(input.sha, options)
});

/** Global GitService descriptors with a closed RPC allowlist and request-local write consent. */
export function createAuthOperations(context, { fetch = globalThis.fetch } = {}) {
  return [
    { name: 'git.auth', global: true, async run(repository, params, operation) {
      return context.invoke(params.method, params.input ?? params.params ?? params, { ...operation, fetch });
    } },
    { name: 'git.provider', global: true, async run(repository, params, operation) {
      checkCancelled(operation.signal);
      if (!Object.hasOwn(providerCalls, params.operation)) throw new GitError('Unsupported', 'Provider operation is not registered');
      const remote = typeof params.remote === 'string' ? params.remote : params.remote?.url;
      let remoteId;
      try { remoteId = params.remoteId ?? new URL(remote).origin; }
      catch { throw new GitError('Unsafe', 'Provider remote URL is required'); }
      const provider = createGitProvider({ remote, provider: params.provider, fetch,
        ...context.providerOptions({ remoteId, credentialId: params.credentialId, writeConsent: params.writeConsent }) });
      try {
        const result = await providerCalls[params.operation](provider, params.input ?? params.args ?? {}, { signal: operation.signal });
        checkCancelled(operation.signal);
        return context.redactor.value(result);
      } finally { provider.client.dispose(); }
    } },
    { name: 'git.snapshot', global: true, async run(repository, params, operation) {
      checkCancelled(operation.signal);
      const remote = typeof params.remote === 'string' ? params.remote : params.remote?.url;
      let remoteId;
      try { remoteId = params.remoteId ?? new URL(remote).origin; }
      catch { throw new GitError('Unsafe', 'Provider remote URL is required'); }
      const transport = createProviderTransport({ remote, provider: params.provider, fetch,
        ...context.providerOptions({ remoteId, credentialId: params.credentialId, writeConsent: params.writeConsent }) });
      const options = { signal: operation.signal, consistency: params.consistency ?? 'strict' };
      try {
        if (params.operation === 'capabilities') return transport.getCapabilities();
        if (params.operation === 'refs') return context.redactor.value(await transport.listRefs(options));
        if (params.operation === 'commit') return context.redactor.value(await transport.commitFiles(params.input, options));
        if (params.operation !== 'read') throw new GitError('Unsupported', 'Snapshot operation is not registered');
        const snapshot = await transport.readSnapshot({ ...params.input, ...options });
        const metadata = context.redactor.value({ ...snapshot, files: undefined });
        return { ...metadata, files: snapshot.files.map(file => ({
          path: context.redactor.text(file.path), mode: file.mode, oid: file.oid,
          content: context.redactor.assertSafeBytes(file.content).slice()
        })) };
      } finally { transport.client.dispose(); }
    } }
  ];
}
