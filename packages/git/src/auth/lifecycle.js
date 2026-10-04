import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { acceptsOAuthScopeHeader, checkedScopes, credentialScopeEvidence } from './scope-evidence.js';

function combinedSignal(first, second) {
  if (!second) return { signal: first, dispose() {} };
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (first.aborted || second.aborted) controller.abort();
  first.addEventListener('abort', abort, { once: true });
  second.addEventListener('abort', abort, { once: true });
  return { signal: controller.signal, dispose() {
    first.removeEventListener('abort', abort);
    second.removeEventListener('abort', abort);
  } };
}

/** Expiry-aware credential operations with one shared refresh and immediate logout cancellation. */
export class CredentialLifecycle {
  #providers = new Map();
  #sessions = new Map();
  #refreshes = new Map();
  #logouts = new Map();
  #scopeUpdates = new Map();
  constructor({ vault, now = Date.now, refreshAheadMs = 60000, onCredential, maximumSessions = 128 }) {
    this.vault = vault;
    this.now = now;
    this.refreshAheadMs = refreshAheadMs;
    this.onCredential = onCredential;
    this.maximumSessions = checkLimit(maximumSessions, 1024, 'Credential session count');
  }

  registerProvider(name, handlers) {
    if (this.#providers.has(name)) throw new GitError('Conflict', 'Credential provider is already registered');
    this.#providers.set(name, handlers);
    return () => this.#providers.delete(name);
  }

  signalFor(id) { return this.#session(id).signal; }

  /** Persist observed scopes only for the session that made the authenticated request. */
  async observeScopes(id, scopes, { sessionSignal, accessToken, scopeState = 'known', scopeSource = 'oauth-header' } = {}) {
    const session = this.#sessions.get(id);
    if (!session || session.signal.aborted || session.signal !== sessionSignal || this.#logouts.has(id)) return Promise.resolve(false);
    const values = checkedScopes(scopes);
    const evidence = credentialScopeEvidence({ scopeState, scopeSource });
    const pending = [this.#scopeUpdates.get(id), this.#refreshes.get(id)].filter(Boolean);
    const job = this.#storeScopes(id, values, { session, accessToken, pending, evidence }).finally(() => {
      if (this.#scopeUpdates.get(id) === job) this.#scopeUpdates.delete(id);
    });
    this.#scopeUpdates.set(id, job);
    return job;
  }

  async #storeScopes(id, scopes, { session, accessToken, pending, evidence }) {
    // Every update keeps its own error; sequencing does not replace a previous caller's rejection.
    await Promise.allSettled(pending);
    checkCancelled(session.signal);
    const credential = await this.vault.get(id);
    checkCancelled(session.signal);
    if (!credential || credential.accessToken !== accessToken) return false;
    if (evidence.scopeSource === 'oauth-header' && !acceptsOAuthScopeHeader(credential)) return false;
    await this.vault.set(id, { ...credential, scopes, permissions: {}, ...evidence });
    if (session.signal.aborted) {
      await this.vault.delete(id);
      throw new GitError('Cancelled', 'Credential scope update cancelled by logout');
    }
    return true;
  }

  #session(id) {
    let session = this.#sessions.get(id);
    if (!session || session.signal.aborted) {
      checkLimit(this.#sessions.size + (session ? 0 : 1), this.maximumSessions, 'Credential session count');
      session = new AbortController();
      this.#sessions.set(id, session);
    }
    return session;
  }

  async credential(id, { forceRefresh = false } = {}) {
    if (this.#logouts.has(id)) throw new GitError('Auth', 'Credential logout is in progress');
    const session = this.#session(id);
    const credential = await this.vault.get(id);
    checkCancelled(session.signal);
    if (!credential) throw new GitError('Auth', 'Sign in is required');
    this.onCredential?.(id, credential);
    if (!forceRefresh && (credential.expiresAt == null || credential.expiresAt > this.now() + this.refreshAheadMs)) return credential;
    if (!this.#refreshes.has(id)) {
      const promise = this.#refresh(id, credential, session, this.#scopeUpdates.get(id)).finally(() => this.#refreshes.delete(id));
      this.#refreshes.set(id, promise);
    }
    return this.#refreshes.get(id);
  }

  async #refresh(id, credential, session, scopeUpdate) {
    if (scopeUpdate) {
      await Promise.allSettled([scopeUpdate]);
      checkCancelled(session.signal);
      credential = await this.vault.get(id);
      if (!credential) throw new GitError('Auth', 'Sign in is required');
    }
    const provider = this.#providers.get(credential.provider);
    if (!credential.refreshToken || !provider?.refresh ||
        (credential.refreshExpiresAt != null && credential.refreshExpiresAt <= this.now())) {
      throw new GitError('Auth', 'Credential expired; sign in again');
    }
    let renewed;
    try { renewed = await provider.refresh(credential, { signal: session.signal }); }
    catch (error) {
      checkCancelled(session.signal);
      throw new GitError('Auth', 'Credential refresh failed; sign in again');
    }
    checkCancelled(session.signal);
    const next = { ...credential, ...renewed, provider: credential.provider, allowedOrigins: [...credential.allowedOrigins] };
    this.onCredential?.(id, next);
    await this.vault.set(id, next);
    if (session.signal.aborted) {
      await this.vault.delete(id);
      throw new GitError('Cancelled', 'Credential refresh cancelled by logout');
    }
    return next;
  }

  async run(id, request, { signal } = {}) {
    const session = this.#session(id);
    const combined = combinedSignal(session.signal, signal);
    try {
      checkCancelled(combined.signal);
      let credential = await this.credential(id);
      checkCancelled(combined.signal);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await request(credential, { signal: combined.signal });
          checkCancelled(combined.signal);
          if (result?.status !== 401) return result;
          if (attempt === 1) throw new GitError('Auth', 'Credential was rejected after refresh');
        } catch (error) {
          checkCancelled(combined.signal);
          if (attempt !== 0 || error?.code !== 'Auth' || error?.details?.status !== 401) throw error;
        }
        credential = await this.credential(id, { forceRefresh: true });
      }
      throw new GitError('Auth', 'Credential was rejected');
    } finally { combined.dispose(); }
  }

  logout(id) {
    if (this.#logouts.has(id)) return this.#logouts.get(id);
    this.#sessions.get(id)?.abort();
    const promise = this.#logout(id).finally(() => this.#logouts.delete(id));
    this.#logouts.set(id, promise);
    return promise;
  }

  async #logout(id) {
    const credential = await this.vault.get(id);
    const refresh = this.#refreshes.get(id);
    if (refresh) await refresh.catch(() => {});
    const scopeUpdate = this.#scopeUpdates.get(id);
    if (scopeUpdate) await Promise.allSettled([scopeUpdate]);
    try {
      if (credential) return await this.#providers.get(credential.provider)?.revoke?.(credential);
    } catch { throw new GitError('Auth', 'Provider revocation failed; the local credential has been removed'); }
    finally { await this.vault.delete(id); this.#sessions.delete(id); }
  }

  async logoutAll() {
    const results = await Promise.allSettled((await this.vault.list()).map(record => this.logout(record.id)));
    await this.vault.clear();
    const failed = results.filter(value => value.status === 'rejected');
    if (failed.length) throw new GitError('Auth', 'Some provider revocations failed; local credentials were removed', { count: failed.length });
  }

  async dispose() {
    for (const session of this.#sessions.values()) session.abort();
    // These callers retain their errors; shutdown only waits until no job can mutate the vault.
    await Promise.allSettled([...this.#refreshes.values(), ...this.#scopeUpdates.values(), ...this.#logouts.values()]);
    this.#sessions.clear();
    this.#providers.clear();
  }
}
