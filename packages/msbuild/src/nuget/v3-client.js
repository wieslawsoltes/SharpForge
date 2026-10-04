import { parseNuGetVersion } from './versioning.js';

const packageId = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(value)) throw new Error('Invalid NuGet package ID');
  return value.toLowerCase();
};

/** Bounded V3 client. Additional resource origins require explicit grants; credentials are host-only. */
export class NuGetV3Client {
  constructor(indexUrl, { fetch: fetcher = globalThis.fetch, allowedOrigins = [], credentials = null,
    hostSide = false, maxBytes = 16777216, maxCacheEntries = 64 } = {}) {
    const url = new URL(indexUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('NuGet feeds require HTTPS');
    if (url.username || url.password) throw new Error('Feed credentials must be passed through a host credential provider');
    if (credentials && !hostSide) throw new Error('Authenticated NuGet feeds require the native host');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 268435456) throw new Error('Invalid NuGet resource byte limit');
    if (!Number.isSafeInteger(maxCacheEntries) || maxCacheEntries < 1 || maxCacheEntries > 1024) {
      throw new Error('Invalid NuGet cache entry limit');
    }
    Object.assign(this, { indexUrl: url.href, fetcher, credentials, hostSide, maxBytes, maxCacheEntries });
    this.allowedOrigins = new Set([url.origin, ...allowedOrigins]);
    this.cache = new Map();
    this.index = null;
  }
  async fetchResource(input, { signal, format = 'json', cache = true } = {}) {
    signal?.throwIfAborted();
    const url = new URL(input);
    if (!this.allowedOrigins.has(url.origin) || url.username || url.password) throw new Error('NuGet resource origin requires a grant: ' + url.origin);
    const key = format + ':' + url.href;
    if (cache && this.cache.has(key)) return structuredClone(this.cache.get(key));
    const headers = this.credentials ? await this.credentials(url) : {};
    const response = await this.fetcher(url.href, { signal, headers, credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw Object.assign(new Error(`NuGet feed request failed (${response.status})`), { status: response.status });
    const declared = Number(response.headers?.get?.('content-length') ?? 0);
    if (declared > this.maxBytes) throw new Error('NuGet resource size limit exceeded');
    let bytes;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = [];
      let length = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > this.maxBytes) throw new Error('NuGet resource size limit exceeded');
          chunks.push(next.value);
        }
      } finally { await reader.cancel(); }
      bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > this.maxBytes) throw new Error('NuGet resource size limit exceeded');
    }
    const text = format === 'bytes' ? null : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value = format === 'bytes' ? bytes : format === 'text' ? text : JSON.parse(text);
    if (cache) {
      while (this.cache.size >= this.maxCacheEntries) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, value);
    }
    return structuredClone(value);
  }
  async service(type, options = {}) {
    this.index ??= await this.fetchResource(this.indexUrl, options);
    if (!Array.isArray(this.index.resources) || this.index.resources.length > 1024) throw new Error('Invalid NuGet V3 service index');
    const resources = this.index.resources.filter(resource => String(resource['@type']).split('/')[0] === type);
    const resource = resources.find(item => /3\.6\.0|3\.0\.0/.test(item['@type'])) ?? resources[0];
    if (!resource?.['@id']) throw new Error('NuGet feed does not provide ' + type);
    return resource['@id'].replace(/\/$/, '');
  }
  async search(query, { skip = 0, take = 50, prerelease = false, signal } = {}) {
    if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(take) || take < 1 || take > 1000) throw new Error('Invalid NuGet search page');
    const url = new URL(await this.service('SearchQueryService', { signal }));
    for (const [key, value] of Object.entries({ q: query, skip, take, prerelease })) url.searchParams.set(key, String(value));
    return this.fetchResource(url, { signal });
  }
  async versions(id, options = {}) {
    const base = await this.service('PackageBaseAddress', options);
    const result = await this.fetchResource(`${base}/${packageId(id)}/index.json`, options);
    if (!Array.isArray(result.versions) || result.versions.length > 100000) throw new Error('Invalid NuGet version listing');
    return result.versions.map(version => parseNuGetVersion(version).normalized);
  }
  async nuspec(id, version, options = {}) {
    const base = await this.service('PackageBaseAddress', options), name = packageId(id);
    return this.fetchResource(`${base}/${name}/${parseNuGetVersion(version).normalized.toLowerCase()}/${name}.nuspec`, { ...options, format: 'text' });
  }
  async registration(id, options = {}) {
    const base = await this.service('RegistrationsBaseUrl', options);
    const root = await this.fetchResource(`${base}/${packageId(id)}/index.json`, options), entries = [];
    if (!Array.isArray(root.items) || root.items.length > 1024) throw new Error('Invalid registration page count');
    for (const page of root.items) {
      const value = page.items ? page : await this.fetchResource(page['@id'], options);
      entries.push(...value.items ?? []);
      if (entries.length > 100000) throw new Error('NuGet registration entry limit exceeded');
    }
    return entries;
  }
  async vulnerabilities(options = {}) {
    const root = await this.fetchResource(await this.service('VulnerabilityInfo', options), options);
    if (!Array.isArray(root) || root.length > 64) throw new Error('Invalid vulnerability resource index');
    const advisories = Object.create(null);
    for (const item of root) {
      const page = await this.fetchResource(item['@id'], options);
      for (const [id, entries] of Object.entries(page)) advisories[id] = [...advisories[id] ?? [], ...entries];
    }
    return advisories;
  }
  clear() { this.cache.clear(); this.index = null; }
}
