import { GitError } from '../src/errors.js';
import { base64Url, encodeBase64, requireCrypto, responseBytes, secureUrl, tokenText } from '../src/auth/security.js';
import { pkceChallenge } from '../src/auth/pkce.js';

const tokenFields = ['access_token', 'token_type', 'scope', 'expires_in', 'refresh_token', 'refresh_token_expires_in', 'id_token'];

/** Reference fetch-style server handler; mount behind HTTPS with the supplied provider allowlist. */
export function createTokenBroker({ providers, allowedAppOrigins, fetch = globalThis.fetch, crypto = globalThis.crypto,
  now = Date.now, maximumTransactions = 1024, lifetimeMs = 600000, maximumBodyBytes = 65536 } = {}) {
  const trusted = new Map();
  const origins = new Set(allowedAppOrigins.map(value => secureUrl(value, { protocols: ['https:'] }).origin));
  const pending = new Map();
  for (const [name, provider] of Object.entries(providers)) {
    secureUrl(provider.tokenUrl, { protocols: ['https:'] });
    if (provider.revokeUrl) secureUrl(provider.revokeUrl, { protocols: ['https:'] });
    const deviceUrl = provider.deviceUrl ?? (name === 'github' ? new URL('/login/device/code', provider.tokenUrl).href :
      name === 'azure' ? provider.tokenUrl.replace(/\/token$/, '/devicecode') : undefined);
    if (deviceUrl) secureUrl(deviceUrl, { protocols: ['https:'] });
    trusted.set(name, { ...provider, deviceUrl, redirectUris: new Set(provider.redirectUris.map(value => secureUrl(value).href)) });
  }

  const prune = () => {
    for (const [id, entry] of pending) if (entry.expiresAt <= now()) pending.delete(id);
  };

  async function upstream(provider, fields, { revoke = false, device = false, poll = false } = {}) {
    const endpoint = revoke ? provider.revokeUrl : device ? provider.deviceUrl : provider.tokenUrl;
    if (!endpoint) throw new GitError('Unsupported', 'Provider requires manual authorization revocation');
    const headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
    const parameters = { ...fields, client_id: provider.clientId,
      ...(device || poll || !provider.clientSecret ? {} : { client_secret: provider.clientSecret }) };
    let body = new URLSearchParams(parameters).toString();
    if (revoke && provider.revokeStyle === 'github') {
      headers.Authorization = `Basic ${encodeBase64(new TextEncoder().encode(`${provider.clientId}:${provider.clientSecret}`))}`;
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({ access_token: fields.token });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(endpoint, { method: revoke && provider.revokeStyle === 'github' ? 'DELETE' : 'POST',
        headers, body, signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
      if (response.redirected || (response.url && new URL(response.url).origin !== new URL(endpoint).origin)) {
        throw new GitError('Unsafe', 'Broker upstream redirects are not permitted');
      }
      const bytes = await responseBytes(response, maximumBodyBytes, controller.signal);
      if (!response.ok && !(poll && response.status === 400)) throw new GitError('Auth', 'Provider rejected the broker request');
      if (revoke && bytes.length === 0) return {};
      let result;
      try { result = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new GitError('Auth', 'Provider returned an invalid token response'); }
      if (poll && ['authorization_pending', 'slow_down', 'access_denied', 'expired_token', 'token_expired'].includes(result.error)) {
        return { error: result.error, ...(result.interval !== undefined ? { interval: result.interval } : {}) };
      }
      if (result.error) throw new GitError('Auth', 'Provider rejected the broker request');
      if (revoke) return {};
      if (device) return Object.fromEntries(['device_code', 'user_code', 'verification_uri', 'verification_url', 'expires_in', 'interval']
        .filter(key => result[key] !== undefined).map(key => [key, result[key]]));
      tokenText(result.access_token);
      return Object.fromEntries(tokenFields.filter(key => result[key] !== undefined).map(key => [key, result[key]]));
    } finally { clearTimeout(timer); }
  }

  function begin(body, provider, origin) {
    prune();
    if (pending.size >= maximumTransactions) throw new GitError('Limit', 'Broker transaction limit exceeded');
    if (!provider.redirectUris.has(body.redirectUri) || new URL(body.redirectUri).origin !== origin) {
      throw new GitError('Auth', 'Redirect URI is not registered for this application origin');
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(body.codeChallenge) || !/^[A-Za-z0-9_-]{43,128}$/.test(body.state)) {
      throw new GitError('Auth', 'Invalid authorization transaction');
    }
    const transactionId = base64Url(requireCrypto(crypto).getRandomValues(new Uint8Array(32)));
    pending.set(transactionId, { origin, provider: body.provider, redirectUri: body.redirectUri,
      state: body.state, challenge: body.codeChallenge, expiresAt: now() + lifetimeMs });
    return { transactionId, expiresIn: lifetimeMs / 1000 };
  }

  async function exchange(body, provider, origin) {
    const transaction = pending.get(body.transactionId);
    if (!transaction || transaction.origin !== origin || transaction.provider !== body.provider) {
      throw new GitError('Auth', 'Broker transaction is invalid or already consumed');
    }
    pending.delete(body.transactionId);
    if (transaction.expiresAt <= now() || transaction.state !== body.state ||
        await pkceChallenge(body.codeVerifier, crypto) !== transaction.challenge) {
      throw new GitError('Auth', 'Broker transaction verification failed');
    }
    return upstream(provider, { code: tokenText(body.code, 'Authorization code'), code_verifier: body.codeVerifier,
      redirect_uri: transaction.redirectUri, grant_type: 'authorization_code' });
  }

  const actions = {
    '/oauth/begin': begin,
    '/oauth/exchange': exchange,
    '/oauth/refresh': (body, provider) => upstream(provider, {
      grant_type: 'refresh_token', refresh_token: tokenText(body.refreshToken, 'Refresh token')
    }),
    '/oauth/revoke': (body, provider) => upstream(provider, {
      token: tokenText(body.accessToken), token_type_hint: 'access_token'
    }, { revoke: true }),
    '/oauth/device/start': (body, provider) => {
      if (body.clientId !== provider.clientId) throw new GitError('Auth', 'OAuth public client identifier does not match');
      return upstream(provider, { scope: String(body.scope ?? '') }, { device: true });
    },
    '/oauth/device/poll': (body, provider) => {
      if (body.clientId !== provider.clientId) throw new GitError('Auth', 'OAuth public client identifier does not match');
      return upstream(provider, { device_code: tokenText(body.deviceCode, 'Device code'),
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }, { poll: true });
    }
  };

  return async request => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    if (!origins.has(origin)) return new Response('{"error":"origin_denied"}', { status: 403, headers });
    headers['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS') {
      headers['Access-Control-Allow-Methods'] = 'POST';
      headers['Access-Control-Allow-Headers'] = 'Content-Type';
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') return new Response('{"error":"method_denied"}', { status: 405, headers });
    try {
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new GitError('Auth', 'JSON request required');
      const action = actions[new URL(request.url).pathname];
      if (!action) return new Response('{"error":"not_found"}', { status: 404, headers });
      const bytes = await responseBytes(request, maximumBodyBytes, request.signal);
      const body = JSON.parse(new TextDecoder().decode(bytes));
      const provider = trusted.get(body.provider);
      if (!provider) throw new GitError('Auth', 'Unknown provider registration');
      const result = await action(body, provider, origin);
      return new Response(JSON.stringify(result), { status: 200, headers });
    } catch (error) {
      const status = error?.code === 'Limit' ? 429 : error?.code === 'Unsupported' ? 501 : 400;
      return new Response('{"error":"broker_request_rejected"}', { status, headers });
    }
  };
}
