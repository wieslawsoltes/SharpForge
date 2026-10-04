import {WorkspaceImportReport} from './import-report.js';

export const DISK_WORKSPACE_LIMITS = Object.freeze({maxFiles: 20000, maxFileBytes: 2_000_000,
  maxAssemblyBytes: 64 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024, maxDepth: 48, eagerThreshold: 256});

export function checkDiskCancelled(signal) {
  if (signal?.aborted) throw new DOMException('Folder scan cancelled', 'AbortError');
}

/** Metadata-only scan. The result is published only after complete traversal; cancellation yields no partial workspace. */
export async function scanDirectory(provider, options = {}) {
  const limits = {...DISK_WORKSPACE_LIMITS, ...options};
  const report = new WorkspaceImportReport({...options, maxEntries: limits.maxFiles * 5});
  const records = [];
  const folders = [];
  const pending = [{path: '', depth: 0}];
  let cursor = 0;
  let visited = 0;
  while (cursor < pending.length) {
    const {path: directory, depth} = pending[cursor++];
    checkDiskCancelled(options.signal);
    if (directory && report.matcher) await nestedIgnore(provider, directory, report, options);
    const entries = typeof provider.iterateDirectory === 'function' ? provider.iterateDirectory(directory, options)
      : await provider.readDirectory(directory, options);
    for await (const entry of entries) {
      checkDiskCancelled(options.signal);
      if (++visited > limits.maxFiles * 5) throw new RangeError('Disk directory entry budget exceeded');
      if (entry.type !== 'file' && entry.type !== 'directory') { report.skip(entry.path, 'unsupported-file-type'); continue; }
      if (entry.name === '.sharpforge' && entry.type === 'directory') {
        await readManifestMetadata(provider, entry.path, records, report, options);
        continue;
      }
      const path = report.admit(entry.path, {directory: entry.type === 'directory'});
      if (path === null) continue;
      if (entry.type === 'directory') {
        if (depth >= limits.maxDepth) { report.skip(path, 'directory-depth-limit'); continue; }
        folders.push(path);
        pending.push({path, depth: depth + 1});
      } else {
        if (records.length >= limits.maxFiles) { report.skip(path, 'file-count-limit'); continue; }
        const maximum = /\.(?:dll|exe|pdb)$/i.test(path) ? limits.maxAssemblyBytes : limits.maxFileBytes;
        if (entry.size > maximum) { report.skip(path, 'file-too-large', `${entry.size} bytes exceeds ${maximum}`); continue; }
        records.push({path, size: entry.size, lastModified: entry.mtime ?? 0, lazy: true});
      }
      if (visited % 128 === 0) {
        options.onProgress?.({entries: visited, files: records.length, folders: folders.length, skipped: report.skipped.length});
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }
  checkDiskCancelled(options.signal);
  options.onProgress?.({entries: visited, files: records.length, folders: folders.length, skipped: report.skipped.length, complete: true});
  return {records, folders, report, limits};
}

async function nestedIgnore(provider, directory, report, options) {
  const path = directory + '/.gitignore';
  try {
    const metadata = await provider.stat(path, options);
    if (metadata.size > 128 * 1024) { report.skip(path, 'gitignore-too-large', 'Nested ignore rules exceed 128 KiB'); return; }
    const bytes = await provider.readFile(path, options);
    report.matcher.append(new TextDecoder('utf-8', {fatal: true}).decode(bytes), {base: directory});
  } catch (error) {
    if (error.code === 'NotFound') return;
    if (error instanceof TypeError || error instanceof RangeError) { report.skip(path, 'invalid-gitignore', error.message); return; }
    throw error;
  }
}

async function readManifestMetadata(provider, directory, records, report, options) {
  const path = directory + '/workspace.json';
  try {
    const metadata = await provider.stat(path, options);
    if (metadata.size > 4 * 1024 * 1024) { report.skip(path, 'manifest-too-large'); return; }
    records.push({path, size: metadata.size, lastModified: metadata.mtime ?? 0, lazy: true});
  } catch (error) { if (error.code !== 'NotFound') throw error; }
}
