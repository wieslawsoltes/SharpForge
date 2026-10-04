import { GitError, checkCancelled, checkLimit } from './errors.js';
import { hashBytes } from './hash.js';
import { gitRequest } from './transport/request.js';
import { validateRemoteUrl } from './transport/http.js';
import { collectBytes, encodeText, decodeText } from './protocol/bytes.js';

export const LFS_VERSION = 'https://git-lfs.github.com/spec/v1';
export const LFS_MEDIA_TYPE = 'application/vnd.git-lfs+json';
export const lfsObjectKey = oid => `lfs/objects/${oid}`;

/** Detect a small UTF-8 LFS pointer. Recognized but malformed pointers raise Corrupt. */
export function parseLfsPointer(bytes, { maxPointerBytes = 1024 } = {}) {
  const prefix = encodeText('version https://git-lfs.github.com/spec/');
  if (!(bytes instanceof Uint8Array) || bytes.length < prefix.length || !prefix.every((value, index) => bytes[index] === value)) return null;
  checkLimit(bytes.length, maxPointerBytes, 'LFS pointer');
  const lines = decodeText(bytes).replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== `version ${LFS_VERSION}`) throw new GitError('Unsupported', 'Unknown LFS pointer version');
  const values = new Map();
  const extensions = [];
  for (const line of lines.slice(1).filter(Boolean)) {
    const separator = line.indexOf(' ');
    if (separator < 0) throw new GitError('Corrupt', 'Malformed LFS pointer field');
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (values.has(name)) throw new GitError('Corrupt', 'Duplicate LFS pointer field');
    values.set(name, value);
    if (name.startsWith('ext-')) extensions.push({ name, value });
    else if (name !== 'oid' && name !== 'size') throw new GitError('Corrupt', 'Unknown LFS pointer field');
  }
  const oid = /^sha256:([0-9a-f]{64})$/.exec(values.get('oid') ?? '')?.[1];
  const sizeText = values.get('size');
  if (!oid || !/^(0|[1-9][0-9]*)$/.test(sizeText ?? '')) throw new GitError('Corrupt', 'Malformed LFS pointer object ID or size');
  const size = checkLimit(Number(sizeText), Number.MAX_SAFE_INTEGER, 'LFS object size');
  return { version: LFS_VERSION, oid, size, extensions };
}

export function encodeLfsPointer({ oid, size, extensions = [] }) {
  if (!/^[0-9a-f]{64}$/.test(oid)) throw new GitError('Corrupt', 'Invalid LFS SHA-256 object ID');
  checkLimit(size, Number.MAX_SAFE_INTEGER, 'LFS object size');
  if (extensions.length) throw new GitError('Unsupported', 'LFS clean extensions require an explicit implementation');
  return encodeText(`version ${LFS_VERSION}\noid sha256:${oid}\nsize ${size}\n`);
}

export async function verifyLfsObject(pointer, bytes) {
  if (pointer.size !== bytes.length || await hashBytes(bytes, { algorithm: 'sha256' }) !== pointer.oid) {
    throw new GitError('Corrupt', 'LFS object size or SHA-256 does not match its pointer', { oid: pointer.oid, size: pointer.size });
  }
  return bytes;
}

/** LFS batch/basic download client. Every action goes through independent transport origin grants. */
export class LfsClient {
  constructor({ transport, endpoint, cache, maxObjectBytes = 256 * 1024 * 1024, maxBatch = 100,
    concurrency = 4, allowInsecureLocalhost = false }) {
    this.transport = transport;
    this.endpoint = validateRemoteUrl(endpoint, { allowInsecureLocalhost }).href.replace(/\/$/, '');
    this.cache = cache;
    this.maxObjectBytes = maxObjectBytes;
    this.maxBatch = checkLimit(maxBatch, 1000, 'LFS batch size');
    this.concurrency = checkLimit(concurrency, 32, 'LFS concurrency');
    if (!this.maxBatch || !this.concurrency) throw new GitError('Limit', 'LFS batching limits must be positive');
  }

  async batch(operation, pointers, { signal, ref } = {}) {
    if (!['download', 'upload'].includes(operation)) throw new GitError('Unsupported', 'Unknown LFS batch operation');
    checkLimit(pointers.length, this.maxBatch, 'LFS batch objects');
    for (const pointer of pointers) {
      encodeLfsPointer(pointer);
      checkLimit(pointer.size, this.maxObjectBytes, 'LFS object');
    }
    const response = await gitRequest(this.transport, {
      url: `${this.endpoint}/objects/batch`, method: 'POST', signal, useProxy: false,
      headers: { Accept: LFS_MEDIA_TYPE, 'Content-Type': LFS_MEDIA_TYPE },
      body: encodeText(JSON.stringify({ operation, transfers: ['basic'], hash_algo: 'sha256',
        objects: pointers.map(({ oid, size }) => ({ oid, size })), ...(ref ? { ref: { name: ref } } : {}) }))
    });
    let result;
    try { result = JSON.parse(decodeText(await collectBytes(response.body ?? response, { maximum: 8 * 1024 * 1024, signal }))); }
    catch (error) {
      if (error instanceof GitError) throw error;
      throw new GitError('Corrupt', 'LFS batch response is invalid JSON', { cause: error.name });
    }
    if (result.transfer && result.transfer !== 'basic') throw new GitError('Unsupported', 'LFS server selected an unsupported transfer adapter');
    if (!Array.isArray(result.objects) || result.objects.length !== pointers.length) {
      throw new GitError('Corrupt', 'LFS batch response omitted requested objects');
    }
    const expected = new Map(pointers.map(pointer => [pointer.oid, pointer.size]));
    for (const object of result.objects) {
      if (!expected.has(object.oid) || expected.get(object.oid) !== object.size) throw new GitError('Corrupt', 'LFS batch returned an unexpected object');
      expected.delete(object.oid);
    }
    return result.objects;
  }

  async action(action, { method = 'GET', body, signal, headers = {} } = {}) {
    if (!action?.href) throw new GitError('Corrupt', 'LFS action does not contain an URL');
    const outgoing = new Headers(headers);
    for (const [name, value] of new Headers(action.header ?? {})) outgoing.set(name, value);
    return gitRequest(this.transport, {
      url: action.href, method, headers: outgoing, body, signal, credentialProvider: null, useProxy: false,
      credentialPurpose: 'git-lfs-action-credentials'
    });
  }

  async download(pointer, options = {}) {
    const [result] = await this.downloadAll([pointer], options);
    return result;
  }

  async downloadAll(pointers, { signal, onProgress, ref } = {}) {
    const results = new Map();
    const pending = [];
    for (const pointer of new Map(pointers.map(item => [item.oid, item])).values()) {
      checkCancelled(signal);
      const cached = await this.cache?.get(lfsObjectKey(pointer.oid), { signal });
      if (cached) results.set(pointer.oid, { state: 'ready', pointer, data: await verifyLfsObject(pointer, cached), cached: true });
      else pending.push(pointer);
    }
    for (let offset = 0; offset < pending.length; offset += this.maxBatch) {
      const batch = pending.slice(offset, offset + this.maxBatch);
      const actions = await this.batch('download', batch, { signal, ref });
      let cursor = 0;
      const worker = async () => {
        while (cursor < actions.length) {
          const object = actions[cursor++];
          const pointer = batch.find(item => item.oid === object.oid);
          if (object.error || !object.actions?.download) {
            results.set(object.oid, { state: 'missing', pointer, message: 'LFS object is unavailable' });
            continue;
          }
          const response = await this.action(object.actions.download, { signal });
          const data = await collectBytes(response.body ?? response, { maximum: Math.min(pointer.size, this.maxObjectBytes), signal });
          await verifyLfsObject(pointer, data);
          await this.cache?.set(lfsObjectKey(pointer.oid), data, { signal });
          results.set(pointer.oid, { state: 'ready', pointer, data, cached: false });
          onProgress?.({ phase: 'lfs-download', completed: results.size, total: pointers.length, bytes: data.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(this.concurrency, actions.length) }, worker));
    }
    return pointers.map(pointer => results.get(pointer.oid));
  }
}
