import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { sanitizeGitExportZip } from '../redact-artifacts.js';

const maximumBytes = 64 * 1024 * 1024;
const zipLimits = Object.freeze({ maxEntries: 10000, maxFileBytes: maximumBytes,
  maxTotalBytes: maximumBytes, maxArchiveBytes: maximumBytes });

/** Sanitize actual download bytes. Canonical Git bundles and binary files are never rewritten. */
export function sanitizeArtifact({ name = '', mimeType = 'application/octet-stream', bytes }, redactor, { signal } = {}) {
  checkCancelled(signal);
  if (!(bytes instanceof Uint8Array)) throw new GitError('Corrupt', 'Artifact bytes must be a Uint8Array');
  checkLimit(bytes.byteLength, maximumBytes, 'Artifact bytes');
  if (typeof name !== 'string' || name.length > 4096 || typeof mimeType !== 'string' ||
      mimeType.length > 256 || /[\u0000-\u001f]/.test(mimeType)) throw new GitError('Unsafe', 'Invalid artifact metadata');
  const prefix = new TextDecoder().decode(bytes.subarray(0, 32));
  const canonical = /\.bundle$/i.test(name) || /git-bundle/i.test(mimeType) || /^# v[23] git bundle\n/.test(prefix);
  let result;
  if (canonical) result = redactor.assertSafeBytes(bytes).slice();
  else if (/\.zip$/i.test(name) || /^(?:application\/zip|application\/x-zip-compressed)(?:;|$)/i.test(mimeType) ||
      (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    try { result = sanitizeGitExportZip(bytes, redactor, zipLimits); }
    catch (error) {
      if (error instanceof GitError) throw error;
      throw new GitError('Corrupt', 'Artifact ZIP could not be safely sanitized');
    }
    mimeType = 'application/zip';
  } else result = sanitizeContent(bytes, { name, mimeType, redactor });
  checkCancelled(signal);
  checkLimit(result.byteLength, maximumBytes, 'Sanitized artifact bytes');
  return { bytes: result, mimeType: redactor.text(mimeType) };
}

function sanitizeContent(bytes, { name, mimeType, redactor }) {
  const json = /\.json$/i.test(name) || /^(?:application\/(?:[a-z0-9.+-]+\+)?json)(?:;|$)/i.test(mimeType);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch {
    if (json) throw new GitError('Corrupt', 'JSON artifact is not valid UTF-8');
    return redactor.assertSafeBytes(bytes).slice();
  }
  if (json) {
    let value;
    try { value = JSON.parse(text); }
    catch { throw new GitError('Corrupt', 'Artifact JSON could not be safely parsed'); }
    // Text redaction also covers object keys while value redaction handles named credential fields.
    return new TextEncoder().encode(redactor.text(JSON.stringify(redactor.value(value), null, 2)));
  }
  if (text.includes('\0')) return redactor.assertSafeBytes(bytes).slice();
  return new TextEncoder().encode(redactor.text(text));
}
