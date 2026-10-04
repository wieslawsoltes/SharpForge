import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { abortableDelay, secureUrl, tokenText } from './security.js';
import { oauthCredential, oauthRequest } from './oauth-http.js';

/** RFC 8628 endpoint presets. Azure uses the Microsoft Entra v2 authorization service. */
export function deviceAuthorizationEndpoints(provider, { tenant = 'organizations', origin = 'https://github.com' } = {}) {
  if (provider === 'github') return {
    device: `${secureUrl(origin, { protocols: ['https:'] }).origin}/login/device/code`,
    token: `${secureUrl(origin, { protocols: ['https:'] }).origin}/login/oauth/access_token`
  };
  if (provider === 'azure' && /^[a-zA-Z0-9.-]{1,253}$/.test(tenant)) return {
    device: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`,
    token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
  };
  throw new GitError('Unsupported', 'Device authorization is unavailable for this provider');
}

/** One in-memory device authorization; cancellation stops both the pending request and polling timer. */
export class OAuthDeviceFlow {
  #active = null;
  #controller = null;
  constructor(options) {
    this.options = { now: Date.now, delay: abortableDelay, maximumPolls: 1000, ...options };
    checkLimit(this.options.maximumPolls, 1000, 'Device polling count');
    tokenText(this.options.clientId, 'OAuth public client ID');
    this.options.endpoints ??= deviceAuthorizationEndpoints(options.provider, options);
  }

  async start({ signal, onCode } = {}) {
    if (this.#controller) throw new GitError('Conflict', 'Device authorization is already running');
    this.#controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, this.#controller.signal]) : this.#controller.signal;
    try { return await this.#begin({ signal: combined, onCode }); }
    catch (error) { this.cancel(); throw error; }
  }

  async #begin({ signal, onCode }) {
    const { endpoints, clientId, scopes = [], now } = this.options;
    const result = this.options.broker ? await this.options.broker.deviceStart({ clientId, scopes, signal }) :
      await oauthRequest(endpoints.device, { client_id: clientId, scope: scopes.join(' ') }, { ...this.options, signal });
    if (result.error) throw new GitError('Auth', 'Device authorization request was rejected');
    const seconds = Number(result.expires_in);
    const interval = Number(result.interval ?? 5);
    checkLimit(seconds, 3600, 'Device code lifetime');
    checkLimit(interval, 300, 'Device polling interval');
    if (!seconds || !interval) throw new GitError('Auth', 'Device authorization returned an invalid lifetime');
    const verificationUri = secureUrl(result.verification_uri ?? result.verification_url, { protocols: ['https:'] }).href;
    this.options.assertOrigin(verificationUri);
    const display = { userCode: tokenText(result.user_code, 'User code'), verificationUri,
      expiresAt: now() + seconds * 1000, interval: interval * 1000 };
    checkCancelled(signal);
    this.#active = { ...display, deviceCode: tokenText(result.device_code, 'Device code') };
    onCode?.(Object.freeze({ ...display }));
    return Object.freeze(display);
  }

  async complete({ signal } = {}) {
    const active = this.#active;
    if (!active) throw new GitError('Auth', 'No pending device authorization');
    const { delay, now, maximumPolls, endpoints, clientId } = this.options;
    signal = signal ? AbortSignal.any([signal, this.#controller.signal]) : this.#controller.signal;
    let interval = active.interval;
    try {
      for (let poll = 0; poll < maximumPolls; poll++) {
        checkCancelled(signal);
        if (now() + interval >= active.expiresAt) throw new GitError('Auth', 'Device authorization expired');
        await delay(interval, signal);
        checkCancelled(signal);
        const result = this.options.broker ? await this.options.broker.devicePoll({ clientId, deviceCode: active.deviceCode, signal }) :
          await oauthRequest(endpoints.token, {
            client_id: clientId, device_code: active.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          }, { ...this.options, signal });
        if (!result.error) return oauthCredential(result, { ...this.options, now: now() });
        if (result.error === 'authorization_pending') continue;
        if (result.error === 'slow_down') {
          interval = Math.max(interval + 5000, Number(result.interval ?? 0) * 1000);
          if (!Number.isFinite(interval) || interval > 300000) throw new GitError('Auth', 'Device polling interval is invalid');
          continue;
        }
        const reasons = { access_denied: 'Device authorization was denied', expired_token: 'Device authorization expired',
          token_expired: 'Device authorization expired' };
        throw new GitError('Auth', reasons[result.error] ?? 'Device authorization failed');
      }
      throw new GitError('Limit', 'Device authorization polling limit exceeded');
    } finally { this.#active = null; this.#controller = null; }
  }

  async authorize(options = {}) { await this.start(options); return this.complete(options); }
  cancel() { this.#controller?.abort(); this.#active = null; this.#controller = null; }
  toJSON() { return { pending: this.#active !== null }; }
}
