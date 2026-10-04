import { GitError } from '../errors.js';
import { requiredGitAuthenticationOrigins } from '../origins.js';
import { OAuthTokenBroker } from './broker.js';
import { oauthCredential, oauthRequest } from './oauth-http.js';
import { secureUrl } from './security.js';

/** Public OAuth endpoints derived from the selected service, never supplied by a token response. */
export function oauthProviderEndpoints(provider, remote, tenant = 'organizations') {
  const origin = secureUrl(remote, { protocols: ['https:'] }).origin;
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(tenant)) throw new GitError('Unsafe', 'Invalid Microsoft Entra tenant');
  const endpoints = {
    github: { authorizeUrl: `${origin}/login/oauth/authorize`, tokenUrl: `${origin}/login/oauth/access_token` },
    gitlab: { authorizeUrl: `${origin}/oauth/authorize`, tokenUrl: `${origin}/oauth/token`, revokeUrl: `${origin}/oauth/revoke` },
    gitea: { authorizeUrl: `${origin}/login/oauth/authorize`, tokenUrl: `${origin}/login/oauth/access_token` },
    azure: { authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token` }
  };
  return endpoints[provider] ?? null;
}

/** Build refresh/revoke handlers from credential-bound public configuration and current origin grants. */
export function createOAuthLifecycleHandlers(provider, { grants, fetch = globalThis.fetch, now = Date.now } = {}) {
  const configuration = credential => {
    const config = credential.oauth;
    if (!config?.clientId || !config.remote || !config.remoteId) throw new GitError('Auth', 'OAuth registration is unavailable; sign in again');
    if (!credential.allowedOrigins.includes(new URL(config.remote).origin)) throw new GitError('Auth', 'OAuth remote binding does not match');
    const permitted = new Set(requiredGitAuthenticationOrigins(config.remote, { provider, ...config }));
    const assertOrigin = url => {
      const parsed = grants.assert(url, { remoteId: config.remoteId, protocols: ['https:'] });
      if (!permitted.has(parsed.origin)) throw new GitError('Auth', 'OAuth credential recipient does not match its authorization');
      return parsed;
    };
    return { config, assertOrigin, endpoints: oauthProviderEndpoints(provider, config.remote, config.tenant),
      broker: config.brokerOrigin ? new OAuthTokenBroker({ provider, origin: config.brokerOrigin, fetch, assertOrigin }) : null };
  };
  return {
    async refresh(credential, { signal }) {
      const { config, endpoints, broker, assertOrigin } = configuration(credential);
      if (!broker && !endpoints) throw new GitError('Unsupported', 'Provider refresh requires a configured broker');
      const response = broker ? await broker.refresh({ refreshToken: credential.refreshToken, signal }) :
        await oauthRequest(endpoints.tokenUrl, { client_id: config.clientId, grant_type: 'refresh_token',
          refresh_token: credential.refreshToken, ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}) },
        { fetch, assertOrigin, signal });
      const next = oauthCredential(response, { provider, allowedOrigins: credential.allowedOrigins, now: now() });
      return { ...next, refreshToken: next.refreshToken ?? credential.refreshToken,
        refreshExpiresAt: response.refresh_token_expires_in === undefined ? credential.refreshExpiresAt : next.refreshExpiresAt,
        ...(response.scope === undefined ? { scopes: credential.scopes,
          scopeState: credential.scopeState, scopeSource: credential.scopeSource } : {}), oauth: config };
    },
    async revoke(credential) {
      if (!credential.oauth) return { remoteRevoked: false, reason: 'provider-portal' };
      const { config, endpoints, broker, assertOrigin } = configuration(credential);
      if (broker) {
        const response = await broker.revoke({ accessToken: credential.accessToken });
        if (response.error) throw new GitError('Auth', 'Provider revocation failed');
        return { remoteRevoked: true };
      }
      if (!endpoints?.revokeUrl) return { remoteRevoked: false, reason: 'provider-portal' };
      const response = await oauthRequest(endpoints.revokeUrl, { client_id: config.clientId, token: credential.accessToken }, { fetch, assertOrigin });
      if (response.error) throw new GitError('Auth', 'Provider revocation failed');
      return { remoteRevoked: true };
    }
  };
}
