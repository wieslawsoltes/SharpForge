import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { credentialAuthorization } from '../auth/pat.js';
import { abortableDelay, responseBytes, secureUrl } from '../auth/security.js';
import { scopesFromHeaders } from '../permissions.js';
import { nextPageUrl, pageItems, retryDelay } from './pagination.js';

const writeMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Bounded provider HTTP client with exact origin grants, no redirects, ETags and at most three retries. */
export class ProviderClient {
  #cache = new Map();
  #cacheBytes = 0;
  #identity = null;
  #writes = new WeakMap();
  constructor({ baseUrl, grants, remoteId, credentialProvider, permissions, fetch = globalThis.fetch,
    now = Date.now, delay = abortableDelay, maximumRetries = 3, maximumResponseBytes = 8 * 1024 * 1024,
    maximumRequestBytes = 8 * 1024 * 1024, maximumPages = 100, maximumItems = 10000,
    maximumCacheBytes = 4 * 1024 * 1024, maximumCacheEntries = 256, timeoutMs = 30000,
    headers = {}, onScopes, sessionSignal, graphqlUrl } = {}) {
    this.baseUrl = secureUrl(baseUrl, { protocols: ['https:'] }).href.replace(/\/?$/, '/');
    this.grants = grants;
    this.remoteId = remoteId;
    this.credentialProvider = credentialProvider;
    this.permissions = permissions;
    this.fetch = fetch;
    this.now = now;
    this.delay = delay;
    this.maximumRetries = checkLimit(maximumRetries, 3, 'Provider retries');
    const bounded = { maximumResponseBytes: [maximumResponseBytes, 64 * 1024 * 1024],
      maximumRequestBytes: [maximumRequestBytes, 64 * 1024 * 1024], maximumCacheBytes: [maximumCacheBytes, 64 * 1024 * 1024],
      maximumCacheEntries: [maximumCacheEntries, 4096], maximumPages: [maximumPages, 1000],
      maximumItems: [maximumItems, 100000], timeoutMs: [timeoutMs, 300000] };
    for (const [name, [value, maximum]] of Object.entries(bounded)) this[name] = checkLimit(value, maximum, name);
    Object.assign(this, { headers, onScopes, sessionSignal, graphqlUrl });
  }

  url(input) {
    const graphql = input === 'graphql' && this.graphqlUrl;
    const url = secureUrl(new URL(graphql || input, this.baseUrl).href, { protocols: ['https:'] });
    const base = new URL(this.baseUrl);
    if (url.origin !== base.origin || (!url.pathname.startsWith(base.pathname) && url.href !== this.graphqlUrl)) {
      throw new GitError('Unsafe', 'Provider request escaped its configured API root');
    }
    for (const key of url.searchParams.keys()) {
      if (/^(?:access_token|refresh_token|token|client_secret|authorization)$/i.test(key)) {
        throw new GitError('Unsafe', 'Credentials in provider query strings are prohibited');
      }
    }
    if (!this.grants?.assert) throw new GitError('Unsafe', 'Provider requests require an origin grant manager');
    return this.grants.assert(url.href, { remoteId: this.remoteId, protocols: ['https:'] });
  }

  async withWrite(operation, description, task, { signal } = {}) {
    const credential = await this.credentialProvider?.({ signal });
    if (!credential) throw new GitError('Auth', 'A credential is required for provider writes');
    if (!this.permissions?.assertWrite) throw new GitError('Auth', 'Provider writes require permission confirmation');
    await this.permissions.assertWrite(credential, operation, { description, remote: this.baseUrl, signal });
    const authorization = Object.freeze({ operation });
    this.#writes.set(authorization, { credential, operation });
    try { return await task(authorization); }
    finally { this.#writes.delete(authorization); }
  }

  async request(input, options = {}) {
    if (this.sessionSignal) options = { ...options, signal: options.signal ?
      AbortSignal.any([options.signal, this.sessionSignal]) : this.sessionSignal };
    checkCancelled(options.signal);
    const method = String(options.method ?? 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new GitError('Unsupported', 'Unsupported HTTP method');
    const mutating = writeMethods.has(method) && options.readOnly !== true;
    if (options.readOnly && method !== 'POST') throw new GitError('Unsafe', 'Only GraphQL queries may use a read-only POST');
    if (options.readOnly) {
      const query = options.body?.query;
      const requestUrl = this.url(input);
      const graphqlUrl = new URL(this.graphqlUrl ?? 'graphql', this.baseUrl);
      const wiql = options.queryKind === 'wiql' && /\/wit\/wiql$/.test(requestUrl.pathname) && /^\s*SELECT\b/i.test(query);
      const graphql = requestUrl.pathname === graphqlUrl.pathname && typeof query === 'string' &&
        /^\s*query\b/.test(query) && !/\b(?:mutation|subscription)\b/.test(query);
      if (!wiql && !graphql) throw new GitError('Unsafe', 'Read-only POST must contain a supported query document');
    }
    if (mutating && !this.#writes.has(options.authorization)) {
      return this.withWrite(options.operation ?? 'pullRequest', options.description ?? 'Modify repository',
        authorization => this.request(input, { ...options, authorization }), options);
    }
    if (mutating && this.#writes.get(options.authorization).operation !== (options.operation ?? 'pullRequest')) {
      throw new GitError('Auth', 'Write authorization does not match the requested operation');
    }
    const credential = this.#writes.get(options.authorization)?.credential ?? await this.credentialProvider?.({ signal: options.signal });
    const identity = credential?.accessToken ?? null;
    if (identity !== this.#identity) { this.clearCache(); this.#identity = identity; }
    const url = this.url(input);
    const headers = new Headers({ Accept: 'application/json', ...this.headers, ...options.headers });
    if (headers.has('authorization') || headers.has('cookie') || headers.has('proxy-authorization')) {
      throw new GitError('Unsafe', 'Credential headers must be supplied by the credential vault');
    }
    if (credential) headers.set('Authorization', credentialAuthorization(credential, url.href));
    const body = this.#body(options.body, headers);
    const key = `${url.href}\n${headers.get('accept')}`;
    const cached = method === 'GET' ? this.#cache.get(key) : null;
    if (cached) headers.set('If-None-Match', cached.etag);
    const result = await this.#perform(url, { ...options, method, body, headers }, cached);
    if (method === 'GET' && result.status !== 304 && result.headers.has('etag')) this.#remember(key, result);
    if (mutating) this.clearCache();
    const scopes = scopesFromHeaders(result.headers);
    if (result.headers.has('x-oauth-scopes')) await this.onScopes?.(scopes, { accessToken: credential?.accessToken });
    return result;
  }

  #body(body, headers) {
    if (body === undefined || body === null) return undefined;
    let result = body;
    if (!(body instanceof Uint8Array) && typeof body !== 'string') {
      result = JSON.stringify(body);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }
    const length = typeof result === 'string' ? new TextEncoder().encode(result).length : result.byteLength;
    checkLimit(length, this.maximumRequestBytes, 'Provider request');
    return result;
  }

  async #perform(url, options, cached) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    try {
      // Preserve the standalone callable contract for native and injected fetch implementations.
      const fetch = this.fetch;
      for (let attempt = 0; attempt <= this.maximumRetries; attempt++) {
        checkCancelled(options.signal);
        const response = await fetch(url.href, { method: options.method, body: options.body, headers: options.headers,
          signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
        if (response.redirected || (response.url && new URL(response.url).origin !== url.origin) || response.status === 0) {
          throw new GitError('Unsafe', 'Provider redirects or opaque responses are prohibited');
        }
        if (response.status === 304 && cached) {
          const headers = new Headers(cached.headers);
          for (const [name, value] of response.headers) headers.set(name, value);
          return { ...structuredClone(cached.result), headers, status: 304, url: url.href };
        }
        const limited = response.status === 429 || (response.status === 403 &&
          (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0'));
        if (limited && attempt < this.maximumRetries) {
          await response.body?.cancel();
          await this.delay(retryDelay(response, { now: this.now(), attempt }), controller.signal);
          continue;
        }
        const bytes = await responseBytes(response, this.maximumResponseBytes, controller.signal);
        if (!response.ok) {
          const code = response.status === 401 || response.status === 403 ? 'Auth' :
            response.status === 404 ? 'NotFound' : [409, 412, 422].includes(response.status) ? 'Conflict' : 'Network';
          throw new GitError(code, limited ? 'Provider rate limit retry budget exhausted' : 'Provider request failed', {
            status: response.status, attempts: attempt + 1
          });
        }
        let data = bytes;
        if (options.responseType === 'text') data = new TextDecoder().decode(bytes);
        else if (options.responseType !== 'bytes') {
          try { data = bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : null; }
          catch { throw new GitError('Corrupt', 'Provider returned invalid JSON'); }
        }
        return { data, headers: response.headers, status: response.status, url: url.href, byteLength: bytes.length };
      }
    } catch (error) {
      if (options.signal?.aborted) throw new GitError('Cancelled', 'Provider operation cancelled');
      if (error instanceof GitError) throw error;
      throw new GitError('Network', controller.signal.aborted ? 'Provider operation timed out' : 'Provider network request failed');
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }

  #remember(key, result) {
    if (!this.maximumCacheEntries || result.byteLength > this.maximumCacheBytes) return;
    const previous = this.#cache.get(key);
    if (previous) { this.#cacheBytes -= previous.result.byteLength; this.#cache.delete(key); }
    while ((this.#cacheBytes + result.byteLength > this.maximumCacheBytes ||
        this.#cache.size >= this.maximumCacheEntries) && this.#cache.size) {
      const oldest = this.#cache.keys().next().value;
      this.#cacheBytes -= this.#cache.get(oldest).result.byteLength;
      this.#cache.delete(oldest);
    }
    const { headers, ...copy } = result;
    this.#cache.set(key, { etag: headers.get('etag'), headers: [...headers], result: structuredClone(copy) });
    this.#cacheBytes += result.byteLength;
  }

  async json(input, options) { return (await this.request(input, options)).data; }

  async paginate(input, { select = pageItems, ...options } = {}) {
    const items = [];
    const visited = new Set();
    let next = this.url(input).href;
    for (let page = 0; next && page < this.maximumPages; page++) {
      if (visited.has(next)) throw new GitError('Corrupt', 'Provider pagination cursor repeated');
      visited.add(next);
      const response = await this.request(next, options);
      const values = select(response.data);
      if (!Array.isArray(values)) throw new GitError('Corrupt', 'Provider page is not a collection');
      checkLimit(items.length + values.length, this.maximumItems, 'Provider result count');
      items.push(...values);
      next = nextPageUrl(response, next);
      if (next) this.url(next);
    }
    if (next) throw new GitError('Limit', 'Provider pagination limit exceeded', { maximumPages: this.maximumPages });
    return items;
  }

  clearCache() { this.#cache.clear(); this.#cacheBytes = 0; }
  dispose() { this.clearCache(); this.#identity = null; }
}
