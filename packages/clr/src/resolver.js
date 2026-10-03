import { asAssemblyName } from './assembly-name.js';
import { compareAssemblyIdentity, compareAssemblyVersions } from './identity.js';
import { checkCancellation, loadError, LoadErrorCode } from './load-errors.js';

function normalizedEntry(entry) {
  if (!entry || !entry.identity) throw loadError(LoadErrorCode.InvalidConfiguration, 'Provider entry requires an identity');
  const identity = asAssemblyName(entry.identity);
  if (identity.publicKey !== null && identity.publicKeyToken === null) {
    throw loadError(LoadErrorCode.InvalidConfiguration, 'Provider full public keys must be normalized');
  }
  return Object.freeze({ ...entry, identity });
}

/** A finite, indexed provider. Entries are supplied by the host; no discovery or I/O is performed. */
export class AssemblyProvider {
  #index = new Map();
  constructor(name, entries, { maxEntries = 10000 } = {}) {
    if (typeof name !== 'string' || !name || !Array.isArray(entries)) throw new TypeError('Named entries are required');
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries must be positive');
    if (entries.length > maxEntries) throw loadError(LoadErrorCode.LimitExceeded, 'Assembly provider entry limit exceeded');
    this.name = name;
    for (const source of entries) {
      const entry = normalizedEntry(source);
      const key = entry.identity.name.toLowerCase();
      if (!this.#index.has(key)) this.#index.set(key, []);
      this.#index.get(key).push(entry);
    }
    for (const values of this.#index.values()) Object.freeze(values);
    Object.freeze(this);
  }

  candidates(name) { return this.#index.get(name.toLowerCase()) ?? Object.freeze([]); }
}

/** Offline ordered binding with explicit version policy, cancellation, cache and deterministic disposal. */
export class AssemblyResolver {
  #providers;
  #policy;
  #cache = new Map();
  #disposed = false;
  constructor({ providers = [], versionPolicy = 'exact', rollForward = 'minor', maxCacheEntries = 4096 } = {}) {
    if (!Array.isArray(providers) || providers.length > 128 || providers.some(provider => !(provider instanceof AssemblyProvider))) {
      throw loadError(LoadErrorCode.InvalidConfiguration, 'Resolver needs at most 128 finite assembly providers');
    }
    if (new Set(providers.map(provider => provider.name)).size !== providers.length) throw new TypeError('Duplicate provider name');
    compareAssemblyIdentity('Policy', 'Policy', { versionPolicy, rollForward });
    if (!Number.isSafeInteger(maxCacheEntries) || maxCacheEntries < 1) throw new RangeError('Invalid cache limit');
    this.#providers = [...providers];
    this.#policy = { versionPolicy, rollForward, maxCacheEntries };
  }

  /** O(providers + same-name candidates) cold; O(display-name length) cached. Throws managed load errors. */
  resolve(reference, { requester = null, signal } = {}) {
    if (this.#disposed) throw loadError(LoadErrorCode.Disposed, 'Assembly resolver has been disposed');
    checkCancellation(signal);
    const identity = asAssemblyName(reference);
    const key = identity.fullName;
    if (this.#cache.has(key)) return this.#cache.get(key);
    const attempts = [];
    const context = { requested: key, requester: requester?.fullName ?? requester, attempts };
    let foundName = false;
    for (const provider of this.#providers) {
      checkCancellation(signal);
      const candidates = provider.candidates(identity.name);
      foundName ||= candidates.length > 0;
      const matches = [];
      for (const candidate of candidates) {
        const comparison = compareAssemblyIdentity(identity, candidate.identity, this.#policy);
        if (comparison.matches) matches.push(candidate);
        else attempts.push({ provider: provider.name, reason: `${candidate.identity.fullName}: ${comparison.mismatches.join(', ')}` });
      }
      if (!candidates.length) attempts.push({ provider: provider.name, reason: 'not found' });
      if (!matches.length) continue;
      matches.sort((left, right) => compareAssemblyVersions(right.identity.version, left.identity.version));
      const selected = matches[0];
      if (matches.length > 1 && compareAssemblyVersions(selected.identity.version, matches[1].identity.version) === 0) {
        throw loadError(LoadErrorCode.ConflictingAssembly, `Ambiguous assembly identity in provider ${provider.name}`, context);
      }
      const result = Object.freeze({ ...selected, provider: provider.name });
      if (this.#cache.size === this.#policy.maxCacheEntries) this.#cache.delete(this.#cache.keys().next().value);
      this.#cache.set(key, result);
      return result;
    }
    const code = foundName ? LoadErrorCode.IdentityMismatch : LoadErrorCode.MissingAssembly;
    throw loadError(code, foundName ? 'No assembly satisfies the requested identity' : 'Assembly was not found', context);
  }

  dispose() {
    this.#disposed = true;
    this.#cache.clear();
    this.#providers = [];
  }
}
