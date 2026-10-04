import {FileSystemError, asFileSystemError, hashFileBytes} from './provider.js';

async function snapshot(provider, root, options) {
  const entries = [];
  const directories = [root];
  let bytes = 0;
  while (directories.length) {
    const path = directories.shift();
    for (const entry of await provider.readDirectory(path, options)) {
      if (entries.length >= provider.maxEntries) throw new FileSystemError('QuotaExceeded', root, 'Rename entry limit exceeded');
      if (entry.type === 'directory') {
        await provider.permission(await provider.directory(entry.path, options), entry.path, {...options, write: true});
        directories.push(entry.path);
      } else {
        await provider.permission(await provider.fileHandle(entry.path, options), entry.path, {...options, write: true});
        entry.bytes = await provider.readFile(entry.path, options);
        entry.hash = await hashFileBytes(entry.bytes, options);
        bytes += entry.bytes.length;
        if (bytes > (options.maxBytes ?? 128 * 1024 * 1024)) throw new FileSystemError('QuotaExceeded', root, 'Rename byte limit exceeded');
      }
      entries.push(entry);
    }
  }
  return entries;
}

async function verifySnapshot(provider, root, entries, options) {
  const expected = new Map(entries.map(entry => [entry.path, entry]));
  const directories = [root];
  for (let index = 0; index < directories.length; index++) {
    for (const entry of await provider.readDirectory(directories[index], options)) {
      const previous = expected.get(entry.path);
      if (!previous || previous.type !== entry.type) throw new FileSystemError('Conflict', root, 'Source directory changed during rename');
      expected.delete(entry.path);
      if (entry.type === 'directory') directories.push(entry.path);
      else if (await hashFileBytes(await provider.readFile(entry.path, options), options) !== previous.hash) {
        throw new FileSystemError('Conflict', entry.path, 'Source changed while the rename was prepared');
      }
    }
  }
  if (expected.size) throw new FileSystemError('Conflict', root, 'Source directory changed during rename');
}

/** Native handle.move when available; otherwise bounded copy/delete with rollback of the new destination. */
export async function renameFileSystemEntry(provider, from, to, options = {}) {
  from = provider.check(from, {...options, write: true, allowRoot: false});
  to = provider.check(to, {...options, write: true, allowRoot: false});
  if (provider.pathPolicy.contains(from, to, {includeSelf: false})) throw new FileSystemError('InvalidPath', to);
  const source = await provider.stat(from, options);
  const handle = source.type === 'file' ? await provider.fileHandle(from, {...options, write: true})
    : await provider.directory(from, {...options, write: true});
  const slash = to.lastIndexOf('/');
  const parent = await provider.directory(slash < 0 ? '' : to.slice(0, slash), {...options, write: true});
  if (source.type === 'file' && options.expectedHash !== undefined) await provider.prepareWrite(from, options);
  if (from === to) return source;
  const sameIdentity = provider.pathPolicy.equals(from, to);
  if (!sameIdentity) {
    try { await provider.stat(to, options); throw new FileSystemError('AlreadyExists', to); }
    catch (error) { if (error.code !== 'NotFound') throw error; }
  }
  if (typeof handle.move === 'function') {
    provider.check(from, options);
    try { await handle.move(parent, to.slice(slash + 1)); }
    catch (error) { throw asFileSystemError(error, from); }
    provider.directoryNames = new WeakMap();
    provider.directoryHandles = new WeakMap();
    provider.events.emit({type: 'renamed', path: to, oldPath: from, source: 'provider'});
    return {...source, path: to};
  }
  if (sameIdentity) throw new FileSystemError('Unavailable', from, 'Case-only rename requires native FileSystemHandle.move support');
  const entries = source.type === 'directory' ? await snapshot(provider, from, options)
    : [{...source, bytes: await provider.readFile(from, options)}];
  let created = false;
  try {
    if (source.type === 'directory') { await provider.createDirectory(to, options); created = true; }
    for (const entry of entries) {
      const target = to + entry.path.slice(from.length);
      if (entry.type === 'directory') await provider.createDirectory(target, options);
      else await provider.writeFile(target, entry.bytes, {...options, overwrite: false, expectedHash: null});
      created = true;
    }
    if (source.type === 'directory') await verifySnapshot(provider, from, entries, options);
    else if (await hashFileBytes(await provider.readFile(from, options), options) !== await hashFileBytes(entries[0].bytes, options)) {
      throw new FileSystemError('Conflict', from, 'Source changed while the rename was prepared');
    }
    await provider.delete(from, {...options, recursive: true});
  } catch (error) {
    if (created) {
      try { await provider.delete(to, {recursive: true}); } catch (cleanupError) { error.cleanupError = cleanupError; }
    }
    throw error;
  }
  provider.events.emit({type: 'renamed', path: to, oldPath: from, source: 'provider'});
  return {...source, path: to, atomic: false};
}
