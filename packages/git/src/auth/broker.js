import { GitError } from '../errors.js';
import { secureUrl, tokenText } from './security.js';
import { oauthRequest } from './oauth-http.js';

/** Browser contract for a configured trusted broker. Client secrets are never accepted by this API. */
export class OAuthTokenBroker {
  constructor({ origin, provider, ...options }) {
    const url = secureUrl(origin, { protocols: ['https:'] });
    if (url.pathname !== '/' || url.search) throw new GitError('Unsafe', 'Broker must be configured as an exact origin');
    this.origin = url.origin;
    this.provider = provider;
    this.options = options;
  }

  async begin({ state, codeChallenge, redirectUri, signal }) {
    const response = await oauthRequest(`${this.origin}/oauth/begin`, {
      provider: this.provider, state, codeChallenge, redirectUri
    }, { ...this.options, signal, json: true });
    if (response.error) throw new GitError('Auth', 'Broker rejected the authorization transaction');
    return tokenText(response.transactionId, 'Broker transaction');
  }

  exchange({ transactionId, code, state, codeVerifier, signal }) {
    return oauthRequest(`${this.origin}/oauth/exchange`, { provider: this.provider, transactionId, code, state, codeVerifier }, {
      ...this.options, signal, json: true
    });
  }

  deviceStart({ clientId, scopes = [], signal }) {
    return oauthRequest(`${this.origin}/oauth/device/start`, { provider: this.provider, clientId, scope: scopes.join(' ') }, {
      ...this.options, signal, json: true
    });
  }

  devicePoll({ clientId, deviceCode, signal }) {
    return oauthRequest(`${this.origin}/oauth/device/poll`, { provider: this.provider, clientId, deviceCode }, {
      ...this.options, signal, json: true
    });
  }

  refresh({ refreshToken, signal }) {
    return oauthRequest(`${this.origin}/oauth/refresh`, { provider: this.provider, refreshToken }, {
      ...this.options, signal, json: true
    });
  }

  revoke({ accessToken, signal }) {
    return oauthRequest(`${this.origin}/oauth/revoke`, { provider: this.provider, accessToken }, {
      ...this.options, signal, json: true
    });
  }
}

export function supportedAuthenticationFlows({ provider, brokerOrigin, deviceEnabled = true } = {}) {
  const flows = ['pat'];
  if (deviceEnabled && ['github', 'azure'].includes(provider)) flows.push('device');
  if (brokerOrigin || ['gitlab', 'azure', 'gitea'].includes(provider)) flows.push('pkce');
  return Object.freeze(flows);
}
