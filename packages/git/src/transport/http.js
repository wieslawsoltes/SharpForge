import { GitError, checkCancelled } from '../errors.js';

export function validateRemoteUrl(value, { allowInsecureLocalhost = false } = {}) {
  let url;
  try { url = new URL(value); }
  catch { throw new GitError('Unsafe', 'Remote URL is not absolute'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowInsecureLocalhost && local && url.protocol === 'http:')) {
    throw new GitError('Unsafe', 'Git network URLs must use HTTPS');
  }
  if (url.username || url.password || url.hash) throw new GitError('Unsafe', 'Remote URL contains credentials or a fragment');
  return url;
}

/** Explicit origin/credential grants, no public proxy defaults and no cross-origin redirect following. */
export class HttpGitTransport {
  constructor({ fetch: fetchImpl = globalThis.fetch, origins = [], credentialOrigins = [], requireOrigin,
    credentialProvider, proxyUrl, allowInsecureLocalhost = false, onCredentialOrigin, onScopes, timeoutMs = 120_000 } = {}) {
    if (typeof fetchImpl !== 'function') throw new GitError('Unsupported', 'HTTP fetch is unavailable');
    this.fetch = fetchImpl;
    this.origins = new Set(origins);
    this.credentialOrigins = new Set(credentialOrigins);
    this.requireOrigin = requireOrigin;
    this.credentialProvider = credentialProvider;
    this.proxyUrl = proxyUrl;
    this.allowInsecureLocalhost = allowInsecureLocalhost;
    this.onCredentialOrigin = onCredentialOrigin;
    this.onScopes = onScopes;
    this.timeoutMs = timeoutMs;
  }

  async grant(origin, credentials, purpose) {
    if (this.requireOrigin) {
      const result = await this.requireOrigin(origin, { credentials, purpose });
      if (result !== false) return;
    } else if ((credentials ? this.credentialOrigins : this.origins).has(origin)) return;
    throw new GitError('Auth', `Origin grant required for ${origin}`, { origin, credentials, purpose });
  }

  async request({ url, method = 'GET', headers = {}, body, signal, useProxy = !!this.proxyUrl,
    credentialProvider = this.credentialProvider, credentialPurpose = 'git-credentials' }) {
    checkCancelled(signal);
    if (!['git-credentials', 'git-lfs-action-credentials'].includes(credentialPurpose)) {
      throw new GitError('Unsafe', 'Unknown Git credential purpose');
    }
    if (credentialPurpose === 'git-lfs-action-credentials' && (credentialProvider !== null || useProxy)) {
      throw new GitError('Unsafe', 'LFS action credentials require a direct request with no repository credential provider');
    }
    const upstream = validateRemoteUrl(url, this);
    await this.grant(upstream.origin, false, 'git-remote');
    let target = upstream;
    if (useProxy) {
      if (!this.proxyUrl) throw new GitError('Network', 'No user-configured Git proxy exists', { origin: upstream.origin });
      target = validateRemoteUrl(this.proxyUrl, this);
      target.searchParams.set('url', upstream.href);
      await this.grant(target.origin, false, 'git-proxy');
    }
    const outgoing = new Headers(headers);
    const suppliedCredentials = outgoing.has('authorization') || outgoing.has('cookie') || outgoing.has('proxy-authorization');
    if (outgoing.has('cookie') || outgoing.has('proxy-authorization')) throw new GitError('Unsafe', 'Cookie and proxy authorization headers are not supported');
    if (suppliedCredentials || credentialProvider) {
      await this.grant(upstream.origin, true, credentialPurpose);
      if (target.origin !== upstream.origin) await this.grant(target.origin, true, 'git-proxy-credentials');
      const credential = await credentialProvider?.({ origin: upstream.origin, url: upstream.href, method, signal });
      for (const [name, value] of new Headers(credential?.headers ?? {})) {
        if (name !== 'authorization') throw new GitError('Unsafe', 'Credential provider may only return Authorization');
        outgoing.set(name, value);
      }
      if (outgoing.has('authorization')) this.onCredentialOrigin?.({ origin: target.origin, upstreamOrigin: upstream.origin, viaProxy: useProxy });
    }
    const timeout = new AbortController();
    const abort = () => timeout.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => timeout.abort(new Error('Git HTTP deadline exceeded')), this.timeoutMs);
    let streaming = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    try {
      // Native browser fetch rejects a transport instance as its Web IDL receiver.
      const fetch = this.fetch;
      const response = await fetch(target.href, {
        method, headers: outgoing, body, signal: timeout.signal, redirect: 'error', credentials: 'omit', cache: 'no-store'
      });
      if (response.type === 'opaque' || response.status === 0) throw new GitError('Network', 'Remote response is not CORS-readable', {
        origin: upstream.origin, proxyOrigin: useProxy ? target.origin : null, requiredOriginGrant: upstream.origin
      });
      if (credentialProvider && outgoing.has('authorization') && response.headers?.has('x-oauth-scopes')) {
        await this.onScopes?.(response.headers.get('x-oauth-scopes').split(/[,\s]+/).filter(Boolean));
      }
      if (!response.body?.getReader) return response;
      streaming = true;
      return wrapResponse(response, cleanup);
    } catch (error) {
      checkCancelled(signal);
      if (error instanceof GitError) throw error;
      throw new GitError('Network', timeout.signal.aborted ? 'Git HTTP request timed out' : 'Git remote could not be reached through CORS', {
        origin: upstream.origin, proxyOrigin: useProxy ? target.origin : null, requiredOriginGrant: upstream.origin
      });
    } finally {
      if (!streaming) cleanup();
    }
  }
}

export const createHttpTransport = options => new HttpGitTransport(options);

function wrapResponse(response, cleanup) {
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) { cleanup(); reader.releaseLock(); controller.close(); }
        else controller.enqueue(next.value);
      } catch (error) { cleanup(); controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { cleanup(); reader.releaseLock(); } }
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
