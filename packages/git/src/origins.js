import { NetworkPolicy, createBrowserCsp } from '@sharpforge/network';
import { GitError, checkLimit } from './errors.js';
import { secureUrl } from './auth/security.js';

/** Required connect origins for a remote; this computes a proposal and does not grant it. */
export function requiredGitOrigins(remote, { provider, proxyOrigin, brokerOrigin } = {}) {
  const url = secureUrl(remote, { protocols: ['https:'] });
  const origins = new Set([url.origin]);
  const kind = provider ?? detectGitProvider(url.href);
  if (kind === 'github' && url.hostname === 'github.com') origins.add('https://api.github.com');
  if (kind === 'bitbucket' && url.hostname === 'bitbucket.org') origins.add('https://api.bitbucket.org');
  for (const extra of [proxyOrigin, brokerOrigin]) if (extra) origins.add(exactOrigin(extra));
  return [...origins].sort();
}

/** Additional OAuth connections are proposed only when a public application registration is configured. */
export function requiredGitAuthenticationOrigins(remote, { provider = detectGitProvider(remote), brokerOrigin, clientId } = {}) {
  const origins = new Set(requiredGitOrigins(remote, { provider }));
  if (clientId && provider === 'azure') {
    origins.add('https://login.microsoftonline.com');
    origins.add('https://microsoft.com');
  }
  if (brokerOrigin) origins.add(exactOrigin(brokerOrigin));
  return [...origins].sort();
}

/** Host detection never treats a hostname suffix or lookalike as a trusted service. */
export function detectGitProvider(remote) {
  const { hostname } = secureUrl(remote, { protocols: ['https:'] });
  if (hostname === 'github.com') return 'github';
  if (hostname === 'gitlab.com') return 'gitlab';
  if (hostname === 'bitbucket.org') return 'bitbucket';
  if (hostname === 'dev.azure.com' || hostname.endsWith('.visualstudio.com')) return 'azure';
  return null;
}

export function exactOrigin(input) {
  const url = secureUrl(input);
  if (url.pathname !== '/' || url.search) throw new GitError('Unsafe', 'Grant must be an exact origin');
  return url.origin;
}

/** Explicit per-remote capability grants; no token or URL path is retained in this manager. */
export class GitOriginGrants {
  #grants = new Map();

  constructor({ grants = {}, maximumOrigins = 100, maximumRemotes = 256 } = {}) {
    this.maximumOrigins = checkLimit(maximumOrigins, 100, 'Origin limit');
    this.maximumRemotes = checkLimit(maximumRemotes, 1024, 'Remote grant count');
    for (const [remoteId, origins] of Object.entries(grants)) this.grant(remoteId, origins);
  }

  grant(remoteId, origins) {
    if (typeof remoteId !== 'string' || !remoteId || remoteId.length > 512 || !Array.isArray(origins)) {
      throw new GitError('Unsafe', 'A remote identifier and explicit origin array are required');
    }
    const entries = new Set(origins.map(exactOrigin));
    checkLimit(this.#grants.size + (this.#grants.has(remoteId) ? 0 : 1), this.maximumRemotes, 'Remote grant count');
    const all = new Set();
    for (const [id, existing] of this.#grants) if (id !== remoteId) for (const origin of existing) all.add(origin);
    for (const origin of entries) all.add(origin);
    checkLimit(all.size, this.maximumOrigins, 'Granted origin count');
    this.#grants.set(remoteId, entries);
    return this.list(remoteId);
  }

  revoke(remoteId, origin) {
    if (origin === undefined) return this.#grants.delete(remoteId);
    return this.#grants.get(remoteId)?.delete(exactOrigin(origin)) ?? false;
  }

  assert(input, { remoteId, protocols = ['https:', 'wss:'] } = {}) {
    const url = secureUrl(input, { protocols });
    const allowed = remoteId === undefined ? this.allowedOrigins() : this.list(remoteId);
    if (!allowed.includes(url.origin)) {
      throw new GitError('Unsafe', 'Remote origin has not been granted', { origin: url.origin });
    }
    return url;
  }

  list(remoteId) { return [...(this.#grants.get(remoteId) ?? [])].sort(); }
  allowedOrigins() { return [...new Set([...this.#grants.values()].flatMap(value => [...value]))].sort(); }
  describe() { return Object.fromEntries([...this.#grants.keys()].sort().map(id => [id, this.list(id)])); }
  toNetworkPolicy(options = {}) { return new NetworkPolicy({ ...options, allowedOrigins: this.allowedOrigins() }); }
  createCsp() { return createBrowserCsp(this.allowedOrigins()); }
}
