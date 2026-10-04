import { decodeWorkspaceFile, encodeWorkspaceFile, readZip, writeZip } from '@sharpforge/archive';
import { GitError } from './errors.js';
import { SecretRedactor } from './redact.js';

/** Sanitize workspace/publish entries before compression; binary secrets fail closed instead of corrupting data. */
export function sanitizeGitExportFiles(files, redactor = new SecretRedactor()) {
  return files.map(file => {
    const path = redactor.text(file.path);
    if (typeof file.text === 'string') {
      const text = redactor.text(file.text);
      const bytes = encodeWorkspaceFile({ ...file, text, originalText: undefined });
      return { ...file, path, text, originalText: text, bytes };
    }
    if (!(file.bytes instanceof Uint8Array)) throw new GitError('Corrupt', 'Export file is missing text or bytes');
    if (!file.directory) {
      const record = decodeWorkspaceFile(file.path, file.bytes);
      if (typeof record.text === 'string') return { ...file, path,
        bytes: encodeWorkspaceFile({ ...record, text: redactor.text(record.text) }) };
    }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); }
    catch { redactor.assertSafeBytes(file.bytes); return { ...file, path, bytes: file.bytes.slice() }; }
    const sanitized = redactor.text(text);
    return { ...file, path, bytes: new TextEncoder().encode(sanitized) };
  });
}

/** Rewrites validated ZIP entries, preserving the archive structure and recomputing CRCs after redaction. */
export function sanitizeGitExportZip(bytes, redactor = new SecretRedactor(), limits = {}) {
  return writeZip(sanitizeGitExportFiles(readZip(bytes, limits), redactor), limits);
}
