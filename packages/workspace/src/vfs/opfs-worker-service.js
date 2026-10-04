import {FileSystemError, fileBytes, hashFileBytes, throwIfCancelled, asFileSystemError} from './provider.js';
import {PathPolicy} from '@sharpforge/archive';

const yieldTurn = () => new Promise(resolve => setTimeout(resolve, 0));

/** Dedicated-worker sync-access implementation; temporary files isolate cancelled or incomplete writes. */
export function createOpfsSyncWorkerHandler({getDirectory = () => navigator.storage.getDirectory(),
  maxFileBytes = 64 * 1024 * 1024, chunkBytes = 256 * 1024} = {}) {
  const policy = new PathPolicy();
  let sequence = 0;

  async function directory(parts, options) {
    let current = await getDirectory();
    for (const name of parts) {
      throwIfCancelled(options.signal);
      policy.normalize(name);
      if (name.includes('/')) throw new FileSystemError('InvalidPath', name);
      current = await current.getDirectoryHandle(name);
    }
    return current;
  }

  async function location(payload, options) {
    const path = policy.normalize(payload.path);
    const parts = path.split('/');
    const name = parts.pop();
    const parent = await directory([...(payload.rootPath ?? []), ...parts], options);
    return {path, name, parent};
  }

  async function syncRead(handle, path, options) {
    if (typeof handle.createSyncAccessHandle !== 'function') {
      throw new FileSystemError('Unavailable', path, 'Synchronous OPFS access requires a supported dedicated worker');
    }
    const access = await handle.createSyncAccessHandle();
    try {
      const size = access.getSize();
      if (size > maxFileBytes) throw new FileSystemError('FileTooLarge', path);
      const output = new Uint8Array(size);
      for (let offset = 0; offset < size;) {
        throwIfCancelled(options.signal);
        const chunk = output.subarray(offset, Math.min(size, offset + chunkBytes));
        const count = access.read(chunk, {at: offset});
        if (!Number.isInteger(count) || count < 1 || count > chunk.length) throw new FileSystemError('Io', path, 'Short OPFS read');
        offset += count;
        await yieldTurn();
      }
      throwIfCancelled(options.signal);
      return output;
    } finally { access.close(); }
  }

  async function read(payload, options) {
    const {path, name, parent} = await location(payload, options);
    return {bytes: await syncRead(await parent.getFileHandle(name), path, options)};
  }

  async function snapshotHash(parent, name, options) {
    try {
      const file = await (await parent.getFileHandle(name)).getFile();
      if (file.size > maxFileBytes) throw new FileSystemError('FileTooLarge', name);
      return await hashFileBytes(new Uint8Array(await file.arrayBuffer()), options);
    } catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
  }

  async function stage(parent, temporary, path, bytes, options) {
    const handle = await parent.getFileHandle(temporary, {create: true});
    if (typeof handle.createSyncAccessHandle !== 'function') throw new FileSystemError('Unavailable', path, 'OPFS sync access is unavailable');
    const access = await handle.createSyncAccessHandle();
    try {
      for (let offset = 0; offset < bytes.length;) {
        throwIfCancelled(options.signal);
        const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkBytes));
        const written = access.write(chunk, {at: offset});
        if (!Number.isInteger(written) || written < 1 || written > chunk.length) throw new FileSystemError('Io', path, 'Short OPFS write');
        offset += written;
        await yieldTurn();
      }
      access.truncate(bytes.length);
      access.flush();
    } finally { access.close(); }
    return handle;
  }

  async function write(payload, options) {
    const bytes = fileBytes(payload.bytes);
    if (bytes.length > maxFileBytes) throw new FileSystemError('FileTooLarge', payload.path);
    const {path, name, parent} = await location(payload, options);
    const before = await snapshotHash(parent, name, options);
    if (before !== null && payload.overwrite === false) throw new FileSystemError('AlreadyExists', path);
    if (before === null && payload.create === false) throw new FileSystemError('NotFound', path);
    if (payload.expectedHash !== undefined && payload.expectedHash !== before) throw new FileSystemError('Conflict', path);
    const temporary = '.sharpforge-opfs-' + (++sequence) + '-' + crypto.randomUUID();
    let stream;
    let created = false;
    try {
      const staged = await stage(parent, temporary, path, bytes, options);
      const hash = await hashFileBytes(bytes, options);
      if (await snapshotHash(parent, name, options) !== before) throw new FileSystemError('Conflict', path);
      throwIfCancelled(options.signal);
      if (typeof staged.move === 'function') await staged.move(parent, name);
      else {
        const destination = await parent.getFileHandle(name, {create: true});
        created = before === null;
        stream = await destination.createWritable();
        await stream.write(await staged.getFile());
        if (before !== null && await snapshotHash(parent, name, options) !== before) throw new FileSystemError('Conflict', path);
        throwIfCancelled(options.signal);
        await stream.close();
        stream = null;
        created = false;
      }
      return {path, type: 'file', size: bytes.length, hash, backend: 'opfs-sync-worker'};
    } catch (error) {
      try { await stream?.abort(); } catch (cleanupError) { error.abortError = cleanupError.message; }
      if (created) {
        try { await parent.removeEntry(name); } catch (cleanupError) { error.cleanupError = cleanupError.message; }
      }
      throw error;
    } finally {
      try { await parent.removeEntry(temporary); }
      catch (cleanupError) { if (cleanupError.name !== 'NotFoundError') throw cleanupError; }
    }
  }

  const operations = new Map([['readFile', read], ['writeFile', write]]);
  return async (method, payload, options = {}) => {
    throwIfCancelled(options.signal);
    const operation = operations.get(method);
    if (!operation) throw new FileSystemError('Unavailable', payload.path, 'Unknown OPFS worker operation');
    try { return await operation(payload, options); }
    catch (error) { throw asFileSystemError(error, payload.path); }
  };
}
