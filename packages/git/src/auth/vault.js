import { GitError, checkLimit } from '../errors.js';
import { requireCrypto, secureUrl, tokenText } from './security.js';
import { IndexedDbCredentialStore } from './indexeddb-store.js';
import { checkedScopes, credentialScopeEvidence } from './scope-evidence.js';

function credentialId(id) {
  if (typeof id !== 'string' || !id || id.length > 512 || /[\u0000-\u001f]/.test(id)) {
    throw new GitError('Auth', 'Invalid credential identifier');
  }
  return id;
}

function checkedCredential(value) {
  if (!value || typeof value !== 'object') throw new GitError('Auth', 'Credential record is required');
  const copy = structuredClone(value);
  delete copy.allowUnverified;
  delete copy.writeConsent;
  copy.scopes = checkedScopes(copy.scopes);
  Object.assign(copy, credentialScopeEvidence(copy));
  tokenText(copy.accessToken);
  if (copy.refreshToken) tokenText(copy.refreshToken, 'Refresh token');
  if (!Array.isArray(copy.allowedOrigins) || !copy.allowedOrigins.length || copy.allowedOrigins.length > 16) {
    throw new GitError('Auth', 'Credential needs bounded explicit origin bindings');
  }
  copy.allowedOrigins = copy.allowedOrigins.map(input => {
    const url = secureUrl(input, { protocols: ['https:', 'wss:'] });
    if (url.pathname !== '/' || url.search) throw new GitError('Auth', 'Invalid credential origin binding');
    return url.origin;
  });
  for (const name of ['expiresAt', 'refreshExpiresAt']) {
    if (copy[name] != null && (!Number.isFinite(copy[name]) || copy[name] < 0)) {
      throw new GitError('Auth', 'Invalid credential expiry');
    }
  }
  return copy;
}

/** Session-only by default. Persistence requires consent and encrypts the entire record with AES-GCM. */
export class CredentialVault {
  #session = new Map();
  #store;
  #crypto;
  #persistent = false;
  #disposed = false;
  #maximum;

  constructor({ store, crypto = globalThis.crypto, maximumCredentials = 64 } = {}) {
    this.#store = store;
    this.#crypto = crypto;
    this.#maximum = checkLimit(maximumCredentials, 1024, 'Credential count');
  }

  get mode() { return this.#persistent ? 'encrypted' : 'session'; }
  #check() { if (this.#disposed) throw new GitError('Disposed', 'Credential vault is disposed'); }

  async enablePersistence({ consent = false } = {}) {
    this.#check();
    if (!consent) throw new GitError('Auth', 'Encrypted credential persistence requires explicit consent');
    requireCrypto(this.#crypto);
    this.#store ??= new IndexedDbCredentialStore();
    if (this.#persistent) return;
    for (const [id, value] of this.#session) await this.#encrypt(id, value);
    this.#session.clear();
    this.#persistent = true;
  }

  async disablePersistence() {
    this.#check();
    if (!this.#persistent) return;
    const values = await Promise.all((await this.#store.list()).map(async id => [id, await this.get(id)]));
    await this.#store.clear();
    for (const [id, value] of values) this.#session.set(id, value);
    this.#persistent = false;
  }

  async #key() {
    const crypto = requireCrypto(this.#crypto);
    const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const key = await this.#store.getOrCreateKey(candidate);
    if (key.extractable || key.algorithm.name !== 'AES-GCM') throw new GitError('Auth', 'Invalid credential encryption key');
    return key;
  }

  async #encrypt(id, value) {
    const crypto = requireCrypto(this.#crypto);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    checkLimit(bytes.length, 65536, 'Credential record');
    try {
      const ciphertext = await crypto.subtle.encrypt({
        name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`sharpforge-git-v1:${id}`)
      }, await this.#key(), bytes);
      await this.#store.set(id, { version: 1, iv, ciphertext });
    } finally { bytes.fill(0); }
  }

  async set(id, record) {
    this.#check();
    credentialId(id);
    const value = checkedCredential(record);
    const ids = this.#persistent ? await this.#store.list() : [...this.#session.keys()];
    checkLimit(ids.length + (ids.includes(id) ? 0 : 1), this.#maximum, 'Credential count');
    if (this.#persistent) await this.#encrypt(id, value);
    else this.#session.set(id, value);
  }

  async get(id, { origin } = {}) {
    this.#check();
    credentialId(id);
    let value = this.#session.get(id);
    if (this.#persistent) {
      const record = await this.#store.get(id);
      if (!record) return null;
      if (record.version !== 1 || record.iv?.byteLength !== 12 || record.ciphertext?.byteLength > 65552) {
        throw new GitError('Auth', 'Invalid encrypted credential envelope');
      }
      let plaintext;
      try {
        plaintext = new Uint8Array(await requireCrypto(this.#crypto).subtle.decrypt({
          name: 'AES-GCM', iv: record.iv, additionalData: new TextEncoder().encode(`sharpforge-git-v1:${id}`)
        }, await this.#key(), record.ciphertext));
        value = checkedCredential(JSON.parse(new TextDecoder().decode(plaintext)));
      } catch { throw new GitError('Auth', 'Encrypted credential cannot be authenticated'); }
      finally { plaintext?.fill(0); }
    }
    if (!value) return null;
    if (origin && !value.allowedOrigins.includes(secureUrl(origin).origin)) {
      throw new GitError('Auth', 'Credential is not bound to the requested origin');
    }
    return structuredClone(value);
  }

  async list() {
    this.#check();
    const ids = this.#persistent ? await this.#store.list() : [...this.#session.keys()];
    return Promise.all(ids.sort().map(async id => {
      const record = await this.get(id);
      return { id, provider: record.provider, scopes: record.scopes ?? [], permissions: record.permissions ?? {},
        ...credentialScopeEvidence(record),
        allowedOrigins: record.allowedOrigins, expiresAt: record.expiresAt ?? null, kind: record.kind ?? 'token' };
    }));
  }

  async delete(id) {
    this.#check();
    credentialId(id);
    this.#session.delete(id);
    if (this.#persistent) await this.#store.delete(id);
  }

  async clear() {
    this.#check();
    this.#session.clear();
    if (this.#store) await this.#store.clear();
  }

  async dispose() {
    this.#session.clear();
    this.#disposed = true;
    await this.#store?.close?.();
  }

  toJSON() { return { mode: this.mode }; }
}
