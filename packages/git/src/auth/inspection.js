import { GitError, checkCancelled } from '../errors.js';
import { permissionStatus } from '../permissions.js';
import { ProviderClient } from '../providers/client.js';
import { providerEndpoint } from '../providers/endpoints.js';

const unavailable = Object.freeze({
  bitbucket: 'The selected Bitbucket token does not expose its complete scopes through a supported self-inspection API.',
  azure: 'Azure PAT management requires a separate Microsoft Entra credential; this PAT cannot inspect its own scopes.'
});

/** Inspect the current credential using documented, read-only APIs; never infer token scopes from a repository role. */
export async function inspectCredential({ credentialId, remoteId, remote, operation }, {
  lifecycle, vault, grants, fetch = globalThis.fetch, signal
}) {
  if (!credentialId) throw new GitError('Auth', 'Sign in before reviewing write permissions');
  checkCancelled(signal);
  let inspection = { available: false, reason: '' };
  await lifecycle.run(credentialId, async (credential, request) => {
    const endpoint = providerEndpoint(remote, { provider: credential.provider });
    grants.assert(remote, { remoteId, protocols: ['https:'] });
    const recipient = grants.assert(endpoint.baseUrl, { remoteId, protocols: ['https:'] });
    if (!credential.allowedOrigins.includes(recipient.origin)) throw new GitError('Auth', 'Credential inspection origin does not match');
    if (unavailable[credential.provider]) {
      inspection = { available: false, reason: unavailable[credential.provider] };
      return;
    }
    if (['gitlab', 'gitea'].includes(credential.provider) && credential.kind !== 'pat') {
      inspection = { available: false, reason: 'OAuth scope evidence comes from the token response.' };
      return;
    }
    const sessionSignal = lifecycle.signalFor(credentialId);
    const observed = { sessionSignal, accessToken: credential.accessToken };
    const client = new ProviderClient({ ...endpoint, grants, remoteId, fetch, maximumRetries: 0,
      maximumResponseBytes: 65536, maximumCacheEntries: 0, credentialProvider: () => credential,
      onScopes: scopes => lifecycle.observeScopes(credentialId, scopes, observed) });
    try {
      const paths = { github: 'user', gitlab: 'personal_access_tokens/self', gitea: 'token' };
      const response = await client.request(paths[credential.provider], request);
      inspection = { available: response.headers.has('x-oauth-scopes'),
        reason: 'This response does not expose the token\'s complete scopes or fine-grained permissions.' };
      if (credential.provider === 'gitea') {
        if (!Array.isArray(response.data?.scopes)) throw new GitError('Corrupt', 'Token inspection omitted scope evidence');
        await lifecycle.observeScopes(credentialId, response.data.scopes, { ...observed, scopeSource: 'gitea-current-token' });
        inspection = { available: true, reason: '' };
      } else if (credential.provider === 'gitlab') {
        const token = response.data;
        if (token?.revoked === true || token?.active === false) throw new GitError('Auth', 'The personal access token is inactive or revoked');
        if (!token || typeof token !== 'object') throw new GitError('Corrupt', 'Invalid token inspection response');
        const granular = Array.isArray(token.granular_scopes) && token.granular_scopes.length > 0;
        if (!Array.isArray(token.scopes) && !granular) throw new GitError('Corrupt', 'Token inspection omitted scope evidence');
        await lifecycle.observeScopes(credentialId, granular ? [] : token.scopes, { ...observed,
          scopeState: granular ? 'unknown' : 'known', scopeSource: granular ? 'gitlab-self-granular' : 'gitlab-self' });
        inspection = { available: !granular, reason: granular ?
          'This token uses GitLab granular resource permissions; their effective repository rights require server enforcement.' : '' };
      }
    } catch (error) {
      if (![403, 404, 405].includes(error?.details?.status)) throw error;
      inspection = { available: false, reason: 'The provider does not allow scope inspection with this credential.' };
    } finally { client.dispose(); }
  }, { signal });
  checkCancelled(signal);
  const credential = await vault.get(credentialId);
  if (!credential) throw new GitError('Auth', 'Credential is no longer signed in');
  const status = permissionStatus(credential, operation);
  return { credentialId, remoteId, provider: credential.provider, ...status,
    inspection: { available: status.scopeState === 'known' && inspection.available,
      reason: status.scopeState === 'known' ? '' : inspection.reason } };
}
