import { openZip, writeZipTo, encodeWorkspaceFile, decodeWorkspaceFile } from '@sharpforge/archive';
import { workspaceManifestRecord, importWorkspaceRecords } from './archive.js';

/** Backpressured workspace export. The returned promise completes only after the sink is closed. */
export async function exportWorkspaceZipTo({ records, folders = [], settings = {} }, sink, options = {}) {
  const writer = sink?.getWriter ? sink.getWriter() : sink;
  let entries;
  try {
    const manifest = workspaceManifestRecord(settings, records);
    entries = records.map(record => ({
      path: record.path ?? record.uri, mode: record.mode, mtime: record.mtime,
      stream: record.stream ? () => typeof record.stream === 'function' ? record.stream() : record.stream :
        record.source ? () => record.source : async function* () { yield encodeWorkspaceFile(record); }
    }));
    entries.push(manifest, ...folders.map(path => ({ path, directory: true })));
  } catch (error) {
    try { await writer?.abort?.(error); } catch (abortError) { error.abortError = abortError; }
    finally { writer?.releaseLock?.(); }
    throw error;
  }
  // The ZIP layer takes this writer directly; it owns close/abort/release after the handoff.
  return writeZipTo(entries, writer, options);
}

/** Read payloads one file at a time. The workspace records remain bounded by maxTotalBytes. */
export async function importWorkspaceZipFromBlob(blob, options = {}) {
  const archive = await openZip(blob, options);
  const records = [];
  const folders = [];
  try {
    for (const entry of archive.entries) {
      options.signal?.throwIfAborted();
      if (entry.directory) { folders.push(entry.path); continue; }
      const record = decodeWorkspaceFile(entry.path, await archive.read(entry, options));
      if (options.preserveMetadata) Object.assign(record, { mtime: entry.mtime, mode: entry.mode });
      records.push(record);
      await options.onProgress?.({ files: records.length, total: archive.entries.length, path: entry.path });
    }
    return importWorkspaceRecords(records, folders);
  } finally { archive.close(); }
}
