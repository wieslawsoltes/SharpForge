import { GitError, checkCancelled } from './errors.js';
import { hashBytes } from './hash.js';
import { LfsClient, LFS_MEDIA_TYPE, lfsObjectKey, parseLfsPointer, encodeLfsPointer, verifyLfsObject } from './lfs.js';
import { encodeText } from './protocol/bytes.js';

/** Built-in clean filter stores binary content and returns the canonical pointer bytes for staging. */
export async function cleanLfs(data, { cache, signal } = {}) {
  checkCancelled(signal);
  if (!cache) throw new GitError('Unsupported', 'LFS clean requires a local object cache');
  const existing = parseLfsPointer(data);
  if (existing) return { data, pointer: existing, oid: existing.oid };
  const oid = await hashBytes(data, { algorithm: 'sha256' });
  const pointer = { oid, size: data.length };
  await cache.set(lfsObjectKey(oid), data, { signal });
  return { data: encodeLfsPointer(pointer), pointer, oid };
}

/** Upload all outgoing LFS binaries before the Git reference transaction is sent. */
export class LfsUploadClient extends LfsClient {
  clean(data, options) { return cleanLfs(data, { ...options, cache: this.cache }); }

  async uploadPointers({ odb, oids, signal, onProgress, ref }) {
    const pointers = new Map();
    for (const oid of oids) {
      checkCancelled(signal);
      const object = await odb.read(oid, { signal });
      if (object.type !== 'blob') continue;
      const pointer = parseLfsPointer(object.data);
      if (pointer) pointers.set(pointer.oid, pointer);
    }
    return this.uploadAll([...pointers.values()], { signal, onProgress, ref });
  }

  async uploadAll(pointers, { signal, onProgress, ref } = {}) {
    const unique = [...new Map(pointers.map(pointer => [pointer.oid, pointer])).values()];
    const results = [];
    for (let offset = 0; offset < unique.length; offset += this.maxBatch) {
      const batch = unique.slice(offset, offset + this.maxBatch);
      const actions = await this.batch('upload', batch, { signal, ref });
      for (const object of actions) {
        checkCancelled(signal);
        if (object.error) {
          const status = object.error.code;
          const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {};
          throw new GitError('Network', 'LFS upload was refused', { oid: object.oid, ...safeStatus });
        }
        const pointer = batch.find(item => item.oid === object.oid);
        if (object.actions?.upload) {
          const data = await this.cache?.get(lfsObjectKey(pointer.oid), { signal });
          if (!data) throw new GitError('NotFound', 'Local binary for an outgoing LFS pointer is missing', { oid: pointer.oid });
          await verifyLfsObject(pointer, data);
          const response = await this.action(object.actions.upload, {
            method: 'PUT', body: data, signal, headers: { 'Content-Type': 'application/octet-stream' }
          });
          if (response.body?.cancel) await response.body.cancel();
        }
        if (object.actions?.verify) {
          const response = await this.action(object.actions.verify, { method: 'POST', signal,
            headers: { Accept: LFS_MEDIA_TYPE, 'Content-Type': LFS_MEDIA_TYPE }, body: encodeText(JSON.stringify({ oid: pointer.oid, size: pointer.size })) });
          if (response.body?.cancel) await response.body.cancel();
        }
        results.push({ oid: pointer.oid, uploaded: !!object.actions?.upload, verified: !!object.actions?.verify });
        onProgress?.({ phase: 'lfs-upload', completed: results.length, total: unique.length, bytes: pointer.size });
      }
    }
    return results;
  }
}
