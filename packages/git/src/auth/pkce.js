import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { base64Url, requireCrypto, secureUrl, tokenText } from './security.js';
import { oauthCredential, oauthRequest } from './oauth-http.js';

/** RFC 7636 S256 challenge. Verifiers stay in memory and never enter a URL or persistent storage. */
export async function pkceChallenge(verifier, crypto = globalThis.crypto) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new GitError('Auth', 'Invalid PKCE verifier');
  return base64Url(new Uint8Array(await requireCrypto(crypto).subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** A bounded, one-use OAuth transaction table. Callback origin, path and state must match exactly. */
export class OAuthPkceFlow {
  #pending = new Map();
  constructor(options) {
    this.options = { crypto: globalThis.crypto, now: Date.now, maximumTransactions: 8, lifetimeMs: 600000, ...options };
    checkLimit(this.options.maximumTransactions, 64, 'Pending OAuth transaction count');
    checkLimit(this.options.lifetimeMs, 600000, 'OAuth transaction lifetime');
    tokenText(this.options.clientId, 'OAuth public client ID');
  }

  async start({ signal } = {}) {
    checkCancelled(signal);
    const { crypto, now, maximumTransactions, lifetimeMs, authorizeUrl, redirectUri, clientId, scopes = [], broker } = this.options;
    for (const [state, transaction] of this.#pending) if (transaction.expiresAt <= now()) this.#pending.delete(state);
    if (this.#pending.size >= maximumTransactions) throw new GitError('Limit', 'Too many pending authorizations');
    const redirect = secureUrl(redirectUri, { protocols: ['https:'] });
    const url = secureUrl(authorizeUrl, { protocols: ['https:'] });
    this.options.assertOrigin(url.href);
    const random = () => base64Url(requireCrypto(crypto).getRandomValues(new Uint8Array(32)));
    const verifier = random();
    const state = random();
    const nonce = random();
    const challenge = await pkceChallenge(verifier, crypto);
    const values = { client_id: clientId, redirect_uri: redirect.href, response_type: 'code', scope: scopes.join(' '),
      state, nonce, code_challenge: challenge, code_challenge_method: 'S256' };
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    const transaction = { verifier, nonce, redirectUri: redirect.href, expiresAt: now() + lifetimeMs };
    if (broker) transaction.brokerTransaction = await broker.begin({ state, codeChallenge: challenge, redirectUri: redirect.href, signal });
    this.#pending.set(state, transaction);
    return { authorizationUrl: url.href, state, expiresAt: transaction.expiresAt };
  }

  async complete(callbackUrl, { signal } = {}) {
    checkCancelled(signal);
    const callback = secureUrl(callbackUrl, { protocols: ['https:'] });
    const state = callback.searchParams.get('state');
    if (!state || callback.searchParams.getAll('state').length !== 1) throw new GitError('Auth', 'OAuth state mismatch');
    const transaction = this.#pending.get(state);
    if (!transaction) throw new GitError('Auth', 'OAuth state mismatch or replayed callback');
    this.#pending.delete(state);
    const expected = new URL(transaction.redirectUri);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || transaction.expiresAt <= this.options.now()) {
      throw new GitError('Auth', 'OAuth callback address or lifetime is invalid');
    }
    for (const [key, value] of expected.searchParams) {
      if (callback.searchParams.get(key) !== value) throw new GitError('Auth', 'OAuth callback query does not match');
    }
    if (callback.searchParams.has('error')) throw new GitError('Auth', 'OAuth authorization was denied');
    if (callback.searchParams.getAll('code').length !== 1) throw new GitError('Auth', 'Missing OAuth authorization code');
    const code = tokenText(callback.searchParams.get('code'), 'Authorization code');
    const { broker, clientId, tokenUrl, validateIdToken, scopes = [] } = this.options;
    const result = broker ? await broker.exchange({
      transactionId: transaction.brokerTransaction, code, state, codeVerifier: transaction.verifier, signal
    }) : await oauthRequest(tokenUrl, {
      client_id: clientId, redirect_uri: transaction.redirectUri, grant_type: 'authorization_code',
      code, code_verifier: transaction.verifier
    }, { ...this.options, signal });
    if (scopes.includes('openid')) {
      if (!validateIdToken || !result.id_token) throw new GitError('Auth', 'OIDC requires a verified ID token');
      const claims = await validateIdToken(result.id_token, { nonce: transaction.nonce, clientId, signal });
      if (claims?.nonce !== transaction.nonce) throw new GitError('Auth', 'OIDC nonce mismatch');
    }
    return oauthCredential(result, { ...this.options, now: this.options.now() });
  }

  cancel(state) { this.#pending.delete(state); }
  clear() { this.#pending.clear(); }
  toJSON() { return { pending: this.#pending.size }; }
}
