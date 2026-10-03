import { GitError, checkCancelled, checkLimit } from './errors.js';
import { validateObjectId } from './odb.js';
import { MemoryStore } from './storage/memory-store.js';
import { encodeStorageText, decodeStorageText } from './storage/store-contract.js';
import { validateDatabaseRef } from './refs/names.js';
import { parsePackedRefs, serializePackedRefs } from './refs/packed.js';
import { parseReflog, serializeReflogEntry } from './refs/reflog.js';

/** Symbolic, loose and packed references with transactional compare-and-swap updates. */
export class RefDatabase {
  constructor({ store = new MemoryStore(), algorithm = 'sha1', maxSymbolicDepth = 16,
    maxReflogBytes = 16 * 1024 * 1024, clock = () => Math.floor(Date.now() / 1000) } = {}) {
    this.store = store;
    this.algorithm = algorithm;
    this.maxSymbolicDepth = maxSymbolicDepth;
    this.maxReflogBytes = maxReflogBytes;
    this.clock = clock;
  }

  async #packed(store, options) {
    if (options?.packed) return options.packed;
    const text = decodeStorageText(await store.get('packed-refs', options));
    return new Map(parsePackedRefs(text ?? '', { algorithm: this.algorithm }).map(entry => [entry.name, entry]));
  }

  async #raw(name, store, options) {
    validateDatabaseRef(name);
    const text = decodeStorageText(await store.get(name, options));
    if (text !== undefined) {
      const value = text.replace(/\r?\n$/u, '');
      if (value.startsWith('ref: ')) return { symbolic: validateDatabaseRef(value.slice(5)) };
      return { oid: validateObjectId(value, this.algorithm) };
    }
    const packed = (await this.#packed(store, options)).get(name);
    return packed ? { oid: packed.oid, peeled: packed.peeled } : null;
  }

  async #resolve(name, store, options = {}) {
    options = { ...options, packed: await this.#packed(store, options) };
    const seen = new Set();
    let ref = validateDatabaseRef(name);
    for (let depth = 0; depth < this.maxSymbolicDepth; depth++) {
      checkCancelled(options.signal);
      if (seen.has(ref)) throw new GitError('Corrupt', 'Symbolic reference cycle', { ref });
      seen.add(ref);
      const value = await this.#raw(ref, store, options);
      if (!value?.symbolic) return { ref, oid: value?.oid ?? null };
      ref = value.symbolic;
    }
    throw new GitError('Limit', 'Symbolic reference depth exceeded', { name, maximum: this.maxSymbolicDepth });
  }

  resolve(name = 'HEAD', options = {}) { return this.#resolve(name, this.store, options); }

  async read(name = 'HEAD', { deref = true, signal } = {}) {
    if (deref) return (await this.resolve(name, { signal })).oid;
    const raw = await this.#raw(name, this.store, { signal });
    return raw?.symbolic ?? raw?.oid ?? null;
  }

  async list(prefix = 'refs/', { signal } = {}) {
    if (typeof prefix !== 'string' || (prefix !== 'HEAD' && !prefix.startsWith('refs/'))) {
      throw new GitError('Unsafe', 'Reference prefix must begin with refs/');
    }
    const packed = await this.#packed(this.store, { signal });
    const options = { signal, packed };
    const names = new Set([...packed.keys(), ...await this.store.list(prefix, { signal })]);
    const result = [];
    for (const name of [...names].filter(name => name.startsWith(prefix) && !name.endsWith('.lock')).sort()) {
      const raw = await this.#raw(name, this.store, options);
      const resolved = await this.resolve(name, options);
      result.push({ name, oid: resolved.oid, ...(raw?.symbolic ? { symbolic: raw.symbolic } : {}),
        ...(raw?.peeled ? { peeled: raw.peeled } : {}) });
    }
    return result;
  }

  async #appendLog(store, name, entry) {
    const key = `logs/${name}`;
    const previous = await store.get(key);
    const record = encodeStorageText(serializeReflogEntry(entry, { algorithm: this.algorithm, clock: this.clock }));
    checkLimit((previous?.length ?? 0) + record.length, this.maxReflogBytes, 'Reflog');
    const combined = new Uint8Array((previous?.length ?? 0) + record.length);
    if (previous) combined.set(previous);
    combined.set(record, previous?.length ?? 0);
    await store.set(key, combined);
  }

  async #prepare(store, updates, options) {
    const prepared = [];
    const targets = new Set();
    for (const update of updates) {
      const name = validateDatabaseRef(update.name);
      const resolved = await this.#resolve(name, store, options);
      const raw = update.deref === false ? await this.#raw(name, store, options) : undefined;
      const actual = update.deref === false ? raw?.symbolic ?? raw?.oid ?? null : resolved.oid;
      const target = update.deref === false ? name : resolved.ref;
      if (Object.hasOwn(update, 'expected') && update.expected !== actual) {
        throw new GitError('Conflict', 'Reference changed since it was read', { name, expected: update.expected, actual });
      }
      if (targets.has(target)) throw new GitError('Conflict', 'Transaction updates the same reference twice', { ref: target });
      targets.add(target);
      const oid = update.oid === null ? null : validateObjectId(update.oid, this.algorithm);
      prepared.push({ ...update, oid, name, target, oldOid: resolved.oid });
    }
    return prepared;
  }

  async #validateNamespaces(store, updates, options) {
    const packed = await this.#packed(store, options);
    const names = new Set([...packed.keys(), ...await store.list('refs/', options)]);
    for (const update of updates) update.oid === null ? names.delete(update.target) : names.add(update.target);
    for (const name of names) {
      if (name.endsWith('.lock')) continue;
      const parts = name.split('/');
      let parent = '';
      for (const part of parts.slice(0, -1)) {
        parent = parent ? `${parent}/${part}` : part;
        if (names.has(parent)) {
          throw new GitError('Conflict', 'Reference name conflicts with an existing directory or reference', { name });
        }
      }
    }
  }

  /** Atomic CAS updates; reflog:false suppresses appends and deleteReflog removes the named ref logs. */
  async transaction(updates, { signal } = {}) {
    if (!Array.isArray(updates)) throw new TypeError('Reference transaction requires an array');
    checkLimit(updates.length, 100000, 'Reference transaction size');
    return this.store.transaction(async store => {
      const packed = await this.#packed(store, { signal });
      const context = { signal, packed };
      const prepared = await this.#prepare(store, updates, context);
      await this.#validateNamespaces(store, prepared, context);
      const head = await this.#resolve('HEAD', store, context);
      let packedChanged = false;
      for (const update of prepared) {
        checkCancelled(signal);
        if (update.oid === null) {
          await store.delete(update.target);
          packedChanged = packed.delete(update.target) || packedChanged;
        } else {
          await store.set(update.target, encodeStorageText(`${update.oid}\n`));
        }
        const logs = new Set([update.name, update.target]);
        if (head.ref === update.target) logs.add('HEAD');
        const entry = { oldOid: update.oldOid, newOid: update.oid, identity: update.identity, message: update.message };
        for (const name of logs) {
          if (update.deleteReflog && (name === update.name || name === update.target)) await store.delete(`logs/${name}`);
          else if (update.reflog !== false) await this.#appendLog(store, name, entry);
        }
      }
      if (packedChanged) await store.set('packed-refs', encodeStorageText(serializePackedRefs(packed.values(), { algorithm: this.algorithm })));
      return prepared.map(update => ({ ref: update.target, oid: update.oid }));
    }, { signal });
  }

  async update(name, oid, options = {}) {
    const [result] = await this.transaction([{ name, oid, ...options }], options);
    return result;
  }

  async delete(name, options = {}) { return this.update(name, null, options); }

  /** Rename a direct ref, its reflog and a referencing HEAD in one compare-and-swap transaction. */
  async rename(name, target, options = {}) {
    validateDatabaseRef(name);
    validateDatabaseRef(target);
    if (name === target) return { ref: name, oid: await this.read(name, options) };
    return this.store.transaction(async store => {
      const packed = await this.#packed(store, options);
      const context = { ...options, packed };
      const source = await this.#raw(name, store, context);
      const destination = await this.#raw(target, store, context);
      if (!source) throw new GitError('NotFound', 'Reference does not exist', { name });
      if (source.symbolic || destination?.symbolic) throw new GitError('Unsupported', 'Rename requires direct references');
      const oid = source.oid;
      const previous = destination?.oid ?? null;
      if (Object.hasOwn(options, 'expected') && options.expected !== oid) {
        throw new GitError('Conflict', 'Reference changed since it was read', { name, expected: options.expected, actual: oid });
      }
      if (Object.hasOwn(options, 'expectedTarget') ? options.expectedTarget !== previous : previous && !options.force) {
        throw new GitError('Conflict', 'Rename destination changed since it was read', { name: target, actual: previous });
      }
      await this.#validateNamespaces(store, [{ target: name, oid: null }, { target, oid }], context);
      const head = await this.#raw('HEAD', store, context);
      if (head?.symbolic === target) throw new GitError('Conflict', 'Cannot replace the checked-out reference');
      const originalLog = await store.get(`logs/${name}`);
      const entry = { oldOid: oid, newOid: oid, identity: options.identity, message: options.message };
      await store.set(target, encodeStorageText(`${oid}\n`));
      await store.delete(name);
      if (packed.delete(name)) {
        await store.set('packed-refs', encodeStorageText(serializePackedRefs(packed.values(), { algorithm: this.algorithm })));
      }
      await store.delete(`logs/${name}`);
      if (originalLog !== undefined) await store.set(`logs/${target}`, originalLog);
      else await store.delete(`logs/${target}`);
      if (originalLog !== undefined || options.reflog !== false) await this.#appendLog(store, target, entry);
      if (head?.symbolic === name) {
        await store.set('HEAD', encodeStorageText(`ref: ${target}\n`));
        if (options.reflog !== false || await store.get('logs/HEAD') !== undefined) {
          // Native rename records the checked-out ref's removal and attachment.
          await this.#appendLog(store, 'HEAD', { ...entry, newOid: null });
          await this.#appendLog(store, 'HEAD', { ...entry, oldOid: null });
        }
      }
      return { ref: target, oid };
    }, options);
  }

  async setSymbolic(name, target, options = {}) {
    validateDatabaseRef(name);
    validateDatabaseRef(target);
    return this.store.transaction(async store => {
      const context = { ...options, packed: await this.#packed(store, options) };
      const raw = await this.#raw(name, store, context);
      const oldOid = (await this.#resolve(name, store, context)).oid;
      const previous = raw?.symbolic ?? raw?.oid ?? null;
      if (Object.hasOwn(options, 'expected') && options.expected !== previous) {
        throw new GitError('Conflict', 'Symbolic reference changed since it was read', { name, actual: previous });
      }
      await this.#validateNamespaces(store, [{ target: name, oid: target }], context);
      await store.set(name, encodeStorageText(`ref: ${target}\n`));
      const result = await this.#resolve(name, store, context);
      await this.#appendLog(store, name, { oldOid, newOid: result.oid, identity: options.identity, message: options.message });
      return { ...result, symbolic: target };
    }, options);
  }

  async reflog(name = 'HEAD', { signal } = {}) {
    validateDatabaseRef(name);
    const text = decodeStorageText(await this.store.get(`logs/${name}`, { signal })) ?? '';
    return parseReflog(text, { algorithm: this.algorithm });
  }

  async pack({ signal, prune = true } = {}) {
    return this.store.transaction(async store => {
      const packed = await this.#packed(store, { signal });
      const context = { signal, packed };
      for (const name of await store.list('refs/', { signal })) {
        if (name.endsWith('.lock')) continue;
        const raw = await this.#raw(name, store, context);
        if (!raw?.oid) continue;
        packed.set(name, { name, oid: raw.oid, ...(raw.peeled ? { peeled: raw.peeled } : {}) });
        if (prune) await store.delete(name);
      }
      await store.set('packed-refs', encodeStorageText(serializePackedRefs(packed.values(), { algorithm: this.algorithm })));
    }, { signal });
  }
}

export { isValidRefName, validateRefName } from './refs/names.js';
export { parsePackedRefs, serializePackedRefs } from './refs/packed.js';
export { parseReflog, serializeReflogEntry } from './refs/reflog.js';
