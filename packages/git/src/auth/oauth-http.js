import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { responseBytes, secureUrl, tokenText } from './security.js';
import { acceptsOAuthScopeHeader, checkedScopes } from './scope-evidence.js';

/** Bounded OAuth request; response text and provider error descriptions never escape as diagnostics. */
export async function oauthRequest(input, fields, {
  fetch = globalThis.fetch, assertOrigin, signal, maximumBytes = 65536, timeoutMs = 30000, json = false
} = {}) {
  checkCancelled(signal);
  const url = secureUrl(input, { protocols: ['https:'] });
  if (typeof assertOrigin !== 'function') throw new GitError('Unsafe', 'OAuth needs an explicit origin grant');
  assertOrigin(url.href);
  const body = json ? JSON.stringify(fields) : new URLSearchParams(fields).toString();
  checkLimit(new TextEncoder().encode(body).length, maximumBytes, 'OAuth request');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url.href, {
      method: 'POST', body, signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded' }
    });
    if (response.redirected || (response.url && new URL(response.url).origin !== url.origin)) {
      throw new GitError('Unsafe', 'OAuth redirects are not permitted');
    }
    const bytes = await responseBytes(response, maximumBytes, controller.signal);
    let result;
    try { result = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new GitError('Auth', 'OAuth server returned an invalid response'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new GitError('Auth', 'Invalid OAuth response');
    if (!response.ok && !result.error) throw new GitError('Auth', 'OAuth request failed', { status: response.status });
    return result;
  } catch (error) {
    if (signal?.aborted) throw new GitError('Cancelled', 'Authentication cancelled');
    if (error instanceof GitError) throw error;
    throw new GitError('Network', controller.signal.aborted ? 'OAuth request timed out' : 'OAuth network request failed');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Normalize OAuth seconds to absolute milliseconds; expiry values must be finite and bounded. */
export function oauthCredential(result, { provider, allowedOrigins, now = Date.now() } = {}) {
  if (result.error) throw new GitError('Auth', 'Authorization was not granted');
  const expiry = value => {
    if (value === undefined) return null;
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 366 * 24 * 3600) {
      throw new GitError('Auth', 'OAuth server returned an invalid token lifetime');
    }
    return now + seconds * 1000;
  };
  if (result.token_type && result.token_type.toLowerCase() !== 'bearer') throw new GitError('Auth', 'Unsupported OAuth token type');
  const accessToken = tokenText(result.access_token);
  const known = result.scope !== undefined && acceptsOAuthScopeHeader({ provider, accessToken });
  return {
    kind: 'oauth', provider, accessToken, allowedOrigins: [...allowedOrigins],
    refreshToken: result.refresh_token ? tokenText(result.refresh_token, 'Refresh token') : undefined,
    expiresAt: expiry(result.expires_in), refreshExpiresAt: expiry(result.refresh_token_expires_in),
    scopes: checkedScopes(String(result.scope ?? '').split(/[ ,]+/).filter(Boolean)),
    scopeState: known ? 'known' : 'unknown',
    scopeSource: result.scope === undefined ? 'none' : 'oauth-response'
  };
}
