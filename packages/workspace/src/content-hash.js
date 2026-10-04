import {workspaceRecordSource} from './transaction-records.js';
import {workspaceRecordByteChunks, encodedWorkspaceRecordBytes} from './source-record-bytes.js';
import {WorkspaceSha256} from './sha256-stream.js';

/** Abort before admission and after every awaited operation without replacing its reason. */
export function throwIfWorkspaceAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Operation cancelled', 'AbortError');
}

/** SHA-256 of exact file bytes, including an encoding preamble. Returns lowercase hexadecimal. */
export async function hashWorkspaceBytes(bytes, {signal} = {}) {
  throwIfWorkspaceAborted(signal);
  if (!(bytes instanceof Uint8Array)) throw new TypeError('File contents must be Uint8Array');
  if (!globalThis.crypto?.subtle) throw new Error('SFW1001: WebCrypto SHA-256 is unavailable');
  const result = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  throwIfWorkspaceAborted(signal);
  return Array.from(result, value => value.toString(16).padStart(2, '0')).join('');
}

/** Use the archive codec so hashes and saves agree for BOM, UTF-16 and untouched legacy encodings. */
export function workspaceRecordBytes(record, options) {
  return encodedWorkspaceRecordBytes(record, options);
}

/** Hash immutable sources in bounded ranges so history never materializes the full compatibility text view. */
export async function hashWorkspaceRecordContent(record, options = {}) {
  throwIfWorkspaceAborted(options.signal);
  if (!workspaceRecordSource(record)) return hashWorkspaceBytes(workspaceRecordBytes(record, options), options);
  const digest = new WorkspaceSha256();
  for (const bytes of workspaceRecordByteChunks(record, options)) {
    throwIfWorkspaceAborted(options.signal);
    // Untouched source records can retain a large original byte buffer; yield within that buffer as well.
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      digest.update(bytes.subarray(offset, offset + 65536));
      await new Promise(resolve => setTimeout(resolve, 0));
      throwIfWorkspaceAborted(options.signal);
    }
  }
  throwIfWorkspaceAborted(options.signal);
  return digest.digest();
}
