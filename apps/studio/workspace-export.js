import {exportWorkspaceZipTo, encodeWorkspaceFile, decodeWorkspaceFile} from '@sharpforge/project-system';

const DEFAULT_STREAM_LIMITS = Object.freeze({maxEntries: 20001, maxTotalBytes: 2 * 1024 * 1024 * 1024 - 1,
  maxArchiveBytes: 2 * 1024 * 1024 * 1024 - 1, maxFileBytes: 64 * 1024 * 1024});

/** Build producers only; bytes enter memory one bounded file at a time as the ZIP sink consumes them. */
export function streamingWorkspaceSnapshot(context, {signal, isCurrent = () => true} = {}) {
  const records = context.records.map(record => ({path: record.path, mode: record.mode, mtime: record.mtime,
    stream: async function* () {
      signal?.throwIfAborted();
      if (!isCurrent()) throw new Error('Workspace changed during ZIP export');
      let bytes;
      if (context.native) {
        bytes = await context.client.binary(record.path, {signal});
        if (typeof record.text === 'string') bytes = encodeWorkspaceFile({...decodeWorkspaceFile(record.path, bytes), text: record.text});
      } else if (typeof record.text === 'string' || record.bytes instanceof Uint8Array) bytes = encodeWorkspaceFile(record);
      else {
        const provider = context.provider ?? context.disk?.provider;
        if (!provider) throw new Error('Original file bytes are unavailable: ' + record.path);
        const metadata = await provider.stat(record.path, {signal});
        if (metadata.type !== 'file' || metadata.size !== record.size ||
            record.lastModified !== undefined && metadata.mtime !== record.lastModified) {
          throw new Error('File changed since the workspace was opened: ' + record.path);
        }
        bytes = await provider.readFile(record.path, {signal});
      }
      signal?.throwIfAborted();
      if (!isCurrent()) throw new Error('Workspace changed during ZIP export');
      for (let offset = 0; offset < bytes.length; offset += 65536) {
        signal?.throwIfAborted();
        yield bytes.subarray(offset, offset + 65536);
      }
    }}));
  const settings = context.native ? {...context.settings, mode: context.solutionPath ? 'solution' : 'folder',
    entry: context.solutionPath ?? undefined,
    startup: context.startup && records.some(record => record.path === context.startup) ? context.startup : undefined} : context.settings;
  return {records, folders: context.folders, settings};
}

/** The caller invokes the picker from its user gesture, then supplies its writable stream here. */
export function exportWorkspaceToWritable(context, writable, options = {}) {
  const snapshot = streamingWorkspaceSnapshot(context, options);
  return exportWorkspaceZipTo(snapshot, writable, {...DEFAULT_STREAM_LIMITS, compression: 'deflate', ...options});
}
