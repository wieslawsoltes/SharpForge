import {readFile, readdir, lstat, rename, rm, rmdir, mkdir, open, link} from 'node:fs/promises';
import {dirname, basename, join} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {portablePath} from '@sharpforge/archive';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const error = (code, path, message) => Object.assign(new Error(message + ': ' + path), {code, path,
  status: code === 'Conflict' || code === 'AlreadyExists' ? 409 : code === 'NotFound' ? 404 : 400});

function cancelled(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Filesystem operation cancelled'), {name: 'AbortError', code: 'Cancelled'});
}

/** Byte-preserving native provider endpoint. Requests remain inside NativeWorkspace's granted root/symlink policy. */
export function createNativeVfsService(workspace, {maxFileBytes = 8 * 1024 * 1024, maxEntries = 100000,
  caseSensitive = process.platform !== 'win32'} = {}) {
  let queue = Promise.resolve();

  async function resolvePath(path, {create = false} = {}) {
    if (path === '') return workspace.root;
    return workspace.path(portablePath(path), {create});
  }

  async function stat(path, options = {}) {
    const file = await resolvePath(path);
    const info = await lstat(file);
    if (!info.isDirectory() && !info.isFile()) throw error('Unavailable', path, 'Only regular files and directories are exposed');
    const result = {path, name: basename(file), type: info.isDirectory() ? 'directory' : 'file', size: info.size, mtime: info.mtimeMs};
    if (options.hash && info.isFile()) result.hash = digest(await bytes(path, options));
    return result;
  }

  async function bytes(path, {signal} = {}) {
    cancelled(signal);
    const file = await resolvePath(path);
    const info = await lstat(file);
    if (!info.isFile()) throw error('IsDirectory', path, 'Cannot read a directory as bytes');
    if (info.size > maxFileBytes) throw error('FileTooLarge', path, 'Native provider byte limit exceeded');
    const content = await readFile(file, {signal});
    cancelled(signal);
    if (content.length > maxFileBytes) throw error('FileTooLarge', path, 'Native provider byte limit exceeded');
    return content;
  }

  async function currentHash(path, options) {
    try { return digest(await bytes(path, options)); }
    catch (failure) { if (failure.code === 'ENOENT' || failure.code === 'NotFound') return null; throw failure; }
  }

  async function checkHash(path, expectedHash, options) {
    if (expectedHash === undefined) return;
    if (expectedHash !== null && !/^[a-f0-9]{64}$/.test(expectedHash)) throw error('InvalidPath', path, 'Expected a SHA-256 baseline');
    if (await currentHash(path, options) !== expectedHash) throw error('Conflict', path, 'Disk bytes changed since the saved baseline');
  }

  async function list(payload, options) {
    const path = payload.path ?? '';
    const root = await resolvePath(path);
    const items = await readdir(root, {withFileTypes: true});
    if (items.length > maxEntries) throw error('QuotaExceeded', path, 'Directory entry limit exceeded');
    const result = [];
    for (const item of items) {
      cancelled(options.signal);
      const child = path ? path + '/' + item.name : item.name;
      if (item.isSymbolicLink()) { result.push({path: child, name: item.name, type: 'symlink', unsupported: 'Symbolic links are not followed'}); continue; }
      if (!item.isFile() && !item.isDirectory()) {
        result.push({path: child, name: item.name, type: 'special', unsupported: 'Special files are not exposed'});
        continue;
      }
      const info = await lstat(join(root, item.name));
      result.push({path: child, name: item.name, type: item.isDirectory() ? 'directory' : 'file', size: info.size, mtime: info.mtimeMs});
    }
    return result.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  }

  async function write(payload, options) {
    const path = portablePath(payload.path);
    if (!Array.isArray(payload.bytes) || payload.bytes.length > maxFileBytes
      || payload.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      throw error('FileTooLarge', path, 'Invalid or oversized native file bytes');
    }
    const content = Buffer.from(payload.bytes);
    const before = await currentHash(path, options);
    if (before === null && payload.create === false) throw error('NotFound', path, 'File does not exist');
    if (before !== null && payload.overwrite === false) throw error('AlreadyExists', path, 'File already exists');
    await checkHash(path, payload.expectedHash, options);
    const file = await resolvePath(path, {create: true});
    const hash = digest(content);
    cancelled(options.signal);
    const temporary = join(dirname(file), '.sharpforge-vfs-' + randomUUID());
    try {
      const mode = before === null ? 0o644 : (await lstat(file)).mode & 0o777;
      const descriptor = await open(temporary, 'wx', mode);
      try { await descriptor.writeFile(content, {signal: options.signal}); await descriptor.sync(); }
      finally { await descriptor.close(); }
      await resolvePath(path, {create: before === null});
      if (await currentHash(path, options) !== before) throw error('Conflict', path, 'Disk changed while the write was prepared');
      cancelled(options.signal);
      if (before === null) await link(temporary, file);
      else await rename(temporary, file);
      return {path, type: 'file', size: content.length, hash};
    } finally { await rm(temporary, {force: true}); }
  }

  async function makeDirectory(payload, options) {
    const path = portablePath(payload.path);
    const parts = path.split('/');
    for (let index = 0; index < parts.length; index++) {
      cancelled(options.signal);
      const current = parts.slice(0, index + 1).join('/');
      const file = await resolvePath(current, {create: true});
      try {
        const info = await lstat(file);
        if (!info.isDirectory()) throw error('NotDirectory', current, 'Parent is not a directory');
      } catch (failure) {
        if (failure.code !== 'ENOENT') throw failure;
        if (!payload.recursive && index !== parts.length - 1) throw error('NotFound', current, 'Parent directory does not exist');
        await mkdir(file);
      }
    }
    return stat(path);
  }

  async function remove(payload, options) {
    const path = portablePath(payload.path);
    const file = await resolvePath(path);
    await checkHash(path, payload.expectedHash, options);
    cancelled(options.signal);
    if (!payload.recursive && (await lstat(file)).isDirectory() && (await readdir(file)).length) {
      throw error('DirectoryNotEmpty', path, 'Directory is not empty');
    }
    const directory = (await lstat(file)).isDirectory();
    if (directory && !payload.recursive) await rmdir(file);
    else await rm(file, {recursive: !!payload.recursive});
    return {path, deleted: true};
  }

  async function move(payload, options) {
    const from = portablePath(payload.from);
    const to = portablePath(payload.to);
    if (to.startsWith(from + '/')) throw error('InvalidPath', to, 'A directory cannot contain itself');
    const source = await resolvePath(from);
    if (from === to) return stat(from);
    const destination = await resolvePath(to, {create: true});
    try { await lstat(destination); throw error('AlreadyExists', to, 'Destination already exists'); }
    catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
    await checkHash(from, payload.expectedHash, options);
    cancelled(options.signal);
    await rename(source, destination);
    return stat(to);
  }

  const handlers = new Map([
    ['capabilities', async () => ({readonly: false, caseSensitive, atomicWrite: true, atomicRename: true,
      persistent: true, watch: true, maxFileBytes, maxEntries})],
    ['stat', (payload, options) => stat(payload.path ?? '', {...options, hash: payload.hash})],
    ['readDirectory', list], ['readFile', async (payload, options) => ({bytes: [...await bytes(payload.path, options)]})],
    ['writeFile', write], ['createDirectory', makeDirectory], ['delete', remove], ['rename', move]
  ]);
  const mutations = new Set(['writeFile', 'createDirectory', 'delete', 'rename']);
  return async (method, payload = {}, options = {}) => {
    cancelled(options.signal);
    const handler = handlers.get(method);
    if (!handler) throw error('Unavailable', payload.path ?? '', 'Unknown native filesystem operation');
    const invoke = () => handler(payload, options);
    try {
      if (!mutations.has(method)) return await invoke();
      const result = queue.then(invoke);
      queue = result.catch(() => {});
      return await result;
    } catch (failure) {
      if (failure.code === 'ENOENT') failure.code = 'NotFound';
      if (failure.code === 'EACCES' || failure.code === 'EPERM') failure.code = 'NoPermissions';
      if (failure.code === 'EEXIST') failure.code = 'AlreadyExists';
      throw failure;
    }
  };
}
