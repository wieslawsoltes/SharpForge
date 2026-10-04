import {hashWorkspaceBytes} from '../content-hash.js';
import {migrateWorkspaceRecovery, sanitizeRecoveryValue} from './schema.js';

function serializable(value) {
  if (value instanceof Uint8Array) return [...value];
  if (Array.isArray(value)) return value.map(serializable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, serializable(value[key])]));
}

/** Envelope checksum covers all sanitized payload fields and exact binary values. */
export async function encodeRecoveryRecord(value, options = {}) {
  const payload = serializable(sanitizeRecoveryValue(migrateWorkspaceRecovery(value, options)));
  const contents = JSON.stringify(payload);
  const checksum = await hashWorkspaceBytes(new TextEncoder().encode(contents), options);
  return JSON.stringify({format: 'sharpforge-recovery-envelope', version: 1, checksum, payload});
}

export async function decodeRecoveryRecord(text, options = {}) {
  if (typeof text !== 'string' || text.length > (options.maxEncodedBytes ?? 512 * 1024 * 1024)) {
    throw new Error('SFW1304: Recovery envelope size limit exceeded');
  }
  const envelope = JSON.parse(text);
  if (envelope.format !== 'sharpforge-recovery-envelope' || envelope.version !== 1 || typeof envelope.checksum !== 'string') {
    throw new Error('SFW1303: Unsupported recovery envelope');
  }
  const contents = JSON.stringify(serializable(envelope.payload));
  if (await hashWorkspaceBytes(new TextEncoder().encode(contents), options) !== envelope.checksum) {
    throw new Error('SFW1305: Recovery checksum mismatch');
  }
  return migrateWorkspaceRecovery(envelope.payload, options);
}

/** Isolate corrupt records and return a report so startup can continue with the last valid checkpoint. */
export async function inspectRecoveryRecord(text, {quarantine, name = 'recovery', ...options} = {}) {
  try { return {record: await decodeRecoveryRecord(text, options), diagnostics: []}; }
  catch (error) {
    if (options.signal?.aborted) throw error;
    if (/SFW1303/.test(error.message)) return {record: null, preserved: true, diagnostics: [{code: 'SFW1303', name, message: error.message}]};
    const report = {code: 'SFW1305', name, message: error.message};
    await quarantine?.({name, text, report});
    return {record: null, quarantined: !!quarantine, diagnostics: [report]};
  }
}
