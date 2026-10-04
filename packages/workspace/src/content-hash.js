import {encodeWorkspaceFile} from '@sharpforge/archive';

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
export function workspaceRecordBytes(record) {
  return encodeWorkspaceFile(record);
}
