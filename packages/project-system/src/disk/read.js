import {portablePath} from '@sharpforge/archive';
import {diskLimits} from './limits.js';
import {DiskWorkspace} from './workspace.js';
import {isTextRecord} from '../workspace-records.js';
import {readWorkspaceFile, sourceReaderOptions, checkReadCancellation, disposePreparedRecords} from './source-reader.js';

const ignored = new Set(['.git', 'node_modules', '.vs', '.sharpforge']);
const isIgnored = path => !/(?:^|\/)\.sharpforge\/workspace\.json$/.test(path) && path.split('/').some(part => ignored.has(part));

/** Read all selected file types. Unknown/binary bytes and repository-relative paths remain intact. */
export async function readBrowserFiles(files, options = {}) {
  const limits = diskLimits(options);
  const reader = sourceReaderOptions(options);
  const list = [...files];
  if (list.length > limits.maxFiles) throw new Error('Disk workspace file limit exceeded');
  const records = [];
  const seen = new Set();
  const folders = new Set();
  const skipped = [];
  let total = 0;
  try {
    checkReadCancellation(reader.signal);
    for (const file of list) {
      checkReadCancellation(reader.signal);
      const path = portablePath(file.webkitRelativePath || file.name);
      if (isIgnored(path)) {
        skipped.push(path);
        continue;
      }
      const key = path.normalize('NFC').toLowerCase();
      if (seen.has(key)) throw new Error('Duplicate or case-colliding disk path: ' + path);
      seen.add(key);
      total += file.size;
      if (file.size > limits.maxAssemblyBytes || total > limits.maxTotalBytes) {
        throw new Error('Disk workspace byte limit exceeded by ' + path);
      }
      records.push(await readWorkspaceFile(file, path, limits, reader));
      let parent = path;
      while (parent.includes('/')) {
        parent = parent.slice(0, parent.lastIndexOf('/'));
        folders.add(parent);
      }
    }
    checkReadCancellation(reader.signal);
  } catch (error) {
    disposePreparedRecords(records);
    throw error;
  }
  Object.defineProperties(records, {folders: {value: [...folders]}, skipped: {value: skipped}, limits: {value: limits},
    readSource: {value: reader.readSource}});
  return records;
}

/** Carry the read policy into the writable workspace; callers opt into large source files explicitly. */
export async function readDirectory(handle, options = {}) {
  const limits = diskLimits(options);
  const reader = sourceReaderOptions(options);
  const records = [];
  const handles = new Map();
  const folders = [];
  const skipped = [];
  const seen = new Set();
  let total = 0;
  let entries = 0;
  async function manifest(child, path) {
    try {
      const file = await (await child.getFileHandle('workspace.json')).getFile();
      total += file.size;
      if (file.size > 4 * 1024 * 1024 || total > limits.maxTotalBytes || records.length >= limits.maxFiles) {
        throw new Error('Workspace manifest or total byte limit exceeded');
      }
      records.push(await readWorkspaceFile(file, path + '/workspace.json', limits, reader));
    } catch (error) { if (error.name !== 'NotFoundError') throw error; }
  }
  async function visit(directory, prefix = '', depth = 0) {
    if (depth > 48) throw new Error('Disk directory depth limit exceeded');
    for await (const [name, child] of directory.entries()) {
      checkReadCancellation(reader.signal);
      if (++entries > limits.maxFiles * 4) throw new Error('Directory entry limit exceeded');
      const path = portablePath(prefix ? prefix + '/' + name : name);
      const key = path.normalize('NFC').toLowerCase();
      if (ignored.has(name)) {
        if (name === '.sharpforge' && child.kind === 'directory') await manifest(child, path);
        else skipped.push(path);
        continue;
      }
      if (seen.has(key)) throw new Error('Case-colliding directory path: ' + path);
      seen.add(key);
      if (child.kind === 'directory') { folders.push(path); await visit(child, path, depth + 1); }
      else if (child.kind === 'file') {
        const file = await child.getFile();
        total += file.size;
        if (file.size > limits.maxAssemblyBytes || total > limits.maxTotalBytes || records.length >= limits.maxFiles) {
          throw new Error('Disk workspace byte/file limit exceeded by ' + path);
        }
        const record = await readWorkspaceFile(file, path, limits, reader);
        records.push(record);
        if (isTextRecord(record)) handles.set(path, child);
      }
    }
  }
  try {
    checkReadCancellation(reader.signal);
    await visit(handle);
    checkReadCancellation(reader.signal);
    return new DiskWorkspace(records, handles, handle.name, folders, skipped, {...limits, readSource: reader.readSource});
  } catch (error) { disposePreparedRecords(records); throw error; }
}
