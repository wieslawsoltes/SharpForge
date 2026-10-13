import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** Host-owned persistent trust store. A workspace file cannot grant its own trust. */
export class WorkspaceTrustStore {
  constructor(path) { this.path = resolve(path); this.pending = Promise.resolve(); }

  async identity(root) {
    const canonical = await realpath(root);
    const path = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    return { key: createHash('sha256').update(path).digest('hex'), root: canonical };
  }

  async read() {
    try {
      const text = await readFile(this.path, 'utf8');
      if (text.length > 1024 * 1024) throw new Error('Trust store exceeds limit');
      const value = JSON.parse(text);
      if (value.version !== 1 || !Array.isArray(value.grants)) throw new Error('Invalid trust store');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, grants: [] };
      throw error;
    }
  }

  async get(root) {
    const { key } = await this.identity(root);
    return (await this.read()).grants.find(grant => grant.key === key) ?? null;
  }

  async change(root, grant) {
    const operation = this.pending.then(async () => {
      const identity = await this.identity(root), value = await this.read();
      value.grants = value.grants.filter(entry => entry.key !== identity.key);
      if (grant) value.grants.push({ ...identity, elevated: grant.elevated === true });
      if (value.grants.length > 4096) throw new Error('Trust grant limit exceeded');
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = this.path + '.' + randomUUID();
      await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.path);
      return grant ? value.grants.at(-1) : null;
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  grant(root, options = {}) { return this.change(root, options); }
  revoke(root) { return this.change(root, null); }
}
