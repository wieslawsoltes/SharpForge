import { decodeWorkspaceFile, encodeWorkspaceFile } from '@sharpforge/archive';
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { workspacePath } from './contract.js';

export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');

/** Read a path already admitted by NativeWorkspace and retain the shared encoding policy. */
export async function readNativeText(workspace, file, input) {
  const info = await lstat(file);
  if (!info.isFile() || info.size > workspace.maxTextBytes) throw new Error('Text file size limit exceeded');
  const bytes = await readFile(file);
  if (bytes.length > workspace.maxTextBytes) throw new Error('Text file size limit exceeded');
  const record = decodeWorkspaceFile(input, bytes, { forceText: true });
  if (typeof record.text !== 'string') throw new Error('Binary files are not editable text');
  return { path: workspacePath(input), text: record.text, encoding: record.encoding, bom: record.bom,
    hash: hashBytes(bytes), size: bytes.length };
}

/** Reuse unchanged original bytes; edited text retains the existing encoding and BOM choice. */
export function encodeNativeText(path, text, current, original) {
  return encodeWorkspaceFile({ path, text,
    ...(current ? { encoding: current.encoding, bom: current.bom, originalText: current.text, bytes: original } : {}) });
}
