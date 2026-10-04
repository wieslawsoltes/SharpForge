import { GitError, checkLimit } from './errors.js';
import { encodeBase64 } from './auth/security.js';

const secretKey = /^(?:access_?token|refresh_?token|id_?token|authorization|password|client_?secret|code_?verifier|device_?code)$/i;
const knownToken = /\b(?:gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|glpat-[A-Za-z0-9_-]{8,})\b/g;
const credentialsInUrl = /(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi;
const tokenQuery = /([?&](?:access_token|refresh_token|token|client_secret|code)=)[^&#\s"']+/gi;

/** Explicit session redaction context for diagnostics and every exported text artifact. */
export class SecretRedactor {
  #values = new Map();
  constructor({ maximumSecrets = 1024, maximumBytes = 64 * 1024 * 1024 } = {}) {
    this.maximumSecrets = maximumSecrets;
    this.maximumBytes = maximumBytes;
  }

  register(value) {
    if (typeof value !== 'string' || !value) return () => {};
    checkLimit(value.length, 16384, 'Redaction secret');
    checkLimit(this.#values.size + (this.#values.has(value) ? 0 : 1), this.maximumSecrets, 'Redaction secret count');
    this.#values.set(value, (this.#values.get(value) ?? 0) + 1);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const remaining = (this.#values.get(value) ?? 1) - 1;
      if (remaining <= 0) this.#values.delete(value);
      else this.#values.set(value, remaining);
    };
  }

  registerCredential(credential) {
    const disposals = [credential?.accessToken, credential?.refreshToken].filter(Boolean).map(value => this.register(value));
    if (credential?.accessToken) {
      const users = new Set([credential.username ?? '', 'x-access-token', 'oauth2']);
      for (const username of users) disposals.push(this.register(encodeBase64(new TextEncoder().encode(`${username}:${credential.accessToken}`))));
    }
    return () => disposals.forEach(dispose => dispose());
  }

  text(input) {
    let output = String(input);
    checkLimit(new TextEncoder().encode(output).length, this.maximumBytes, 'Redaction input');
    for (const value of [...this.#values.keys()].sort((left, right) => right.length - left.length)) {
      for (const encoded of new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])) {
        output = output.split(encoded).join('[REDACTED]');
      }
    }
    return output.replace(credentialsInUrl, '$1').replace(tokenQuery, '$1[REDACTED]').replace(knownToken, '[REDACTED]');
  }

  value(input) {
    let visited = 0;
    const seen = new WeakSet();
    const walk = (value, depth) => {
      checkLimit(++visited, 100000, 'Redaction nodes');
      checkLimit(depth, 64, 'Redaction depth');
      if (typeof value === 'string') return this.text(value);
      if (value === null || typeof value !== 'object') return value;
      if (seen.has(value)) throw new GitError('Unsafe', 'Cannot export cyclic secret-bearing data');
      seen.add(value);
      const result = Array.isArray(value) ? value.map(entry => walk(entry, depth + 1)) :
        Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, secretKey.test(key) ? '[REDACTED]' : walk(entry, depth + 1)]));
      seen.delete(value);
      return result;
    };
    return walk(input, 0);
  }

  /** Reject binary outputs containing registered secrets; never corrupt archives by replacing compressed bytes. */
  assertSafeBytes(bytes) {
    checkLimit(bytes.byteLength, this.maximumBytes, 'Export byte count');
    if (this.#containsSecret(new TextDecoder().decode(bytes))) throw new GitError('Unsafe', 'Artifact contains credential material');
    // Source exports and native artifacts can contain UTF-16 at either byte alignment.
    for (const encoding of ['utf-16le', 'utf-16be']) {
      for (const offset of [0, 1]) {
        if (this.#containsSecret(new TextDecoder(encoding).decode(bytes.subarray(offset)))) {
          throw new GitError('Unsafe', 'Artifact contains credential material');
        }
      }
    }
    return bytes;
  }

  #containsSecret(text) {
    for (const value of this.#values.keys()) {
      for (const encoded of new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])) {
        if (text.includes(encoded)) return true;
      }
    }
    for (const expression of [knownToken, credentialsInUrl, tokenQuery]) {
      expression.lastIndex = 0;
      if (expression.test(text)) return true;
    }
    return false;
  }

  clear() { this.#values.clear(); }
  toJSON() { return { redaction: true }; }
}

export function redactGitUrl(url) {
  return new SecretRedactor().text(url);
}
