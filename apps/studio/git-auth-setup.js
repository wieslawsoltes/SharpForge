import { GitError, OAuthDeviceFlow, OAuthPkceFlow, OAuthTokenBroker, requiredGitOrigins,
  requiredGitAuthenticationOrigins, deviceAuthorizationEndpoints, oauthProviderEndpoints } from '@sharpforge/git';
import { authorizeGitPopup } from './git-auth-popup.js';

const defaultScopes = Object.freeze({ github: ['repo'], gitlab: ['api'], bitbucket: ['repository', 'pullrequest'],
  azure: ['499b84ac-1321-427f-aa17-267ca6975798/.default', 'offline_access'], gitea: ['read:repository', 'read:user'] });

/** Prepare public OAuth configuration; only a user's sign-in action grants the listed authorization origins. */
export function createGitAuthSetup({ settings, grants, invoke, remote, provider, remoteId = new URL(remote).origin,
  window = globalThis.window, fetch = globalThis.fetch, validateIdToken } = {}) {
  const values = settings.values ?? settings;
  if (!values.clientId) return { brokerOrigin: values.brokerOrigin || undefined };
  const authorizationOrigins = requiredGitAuthenticationOrigins(remote, { provider, ...values });
  const allowedOrigins = requiredGitOrigins(remote, { provider });
  const scopes = values.oauthScopes?.trim() ? values.oauthScopes.trim().split(/[ ,]+/) : defaultScopes[provider] ?? [];
  const assertOrigin = input => grants.assert(input, { remoteId, protocols: ['https:'] });
  const grantAuthorization = async () => {
    const origins = [...new Set([...grants.list(remoteId), ...authorizationOrigins])];
    await invoke('grant', { remoteId, origins, consent: true });
    grants.grant(remoteId, origins);
  };
  const broker = values.brokerOrigin ? new OAuthTokenBroker({ origin: values.brokerOrigin, provider, assertOrigin, fetch }) : null;
  const options = { provider, clientId: values.clientId, scopes, allowedOrigins, assertOrigin, fetch, validateIdToken, broker };
  const callbackUri = values.redirectUri || (window?.location ? new URL('./git-oauth-callback.html', window.location.href).href : undefined);
  const bind = credential => ({ ...credential, oauth: { clientId: values.clientId, remoteId, remote,
    brokerOrigin: values.brokerOrigin || undefined, tenant: values.oauthTenant ?? 'organizations', redirectUri: callbackUri } });
  const configured = { brokerOrigin: values.brokerOrigin || undefined, authorizationOrigins };
  if (['github', 'azure'].includes(provider)) {
    const device = new OAuthDeviceFlow({ ...options,
      endpoints: deviceAuthorizationEndpoints(provider, { tenant: values.oauthTenant, origin: new URL(remote).origin }) });
    configured.deviceFlow = { async authorize(request) {
      await grantAuthorization();
      return bind(await device.authorize(request));
    } };
  }
  const endpoints = oauthProviderEndpoints(provider, remote, values.oauthTenant ?? 'organizations');
  if (endpoints && (provider !== 'github' || broker)) {
    const redirectUri = callbackUri;
    if (new URL(redirectUri).origin !== window.location.origin) throw new GitError('Auth', 'OAuth callback must belong to this IDE origin');
    const flow = new OAuthPkceFlow({ ...options, ...endpoints, redirectUri, broker });
    configured.pkceFlow = async request => bind(await authorizeGitPopup({ flow, window, ...request, prepare: grantAuthorization }));
  }
  return configured;
}
