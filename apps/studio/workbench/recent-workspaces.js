import {validateItemPath, validateWorkspaceSettings} from '@sharpforge/project-system';
import {abortError, assertId} from './events.js';

/** Derive a stable MRU identity from metadata only; source records and permission handles are never retained. */
export function recentWorkspaceItem(metadata) {
  if (!metadata || typeof metadata !== 'object') throw new TypeError('Recent workspace metadata is required');
  const name = metadata.name ?? metadata.label ?? metadata.entry ?? metadata.uri;
  const uri = metadata.sampleId ? 'sample:' + metadata.sampleId : metadata.uri ??
    'workspace:' + encodeURIComponent(metadata.workspaceId ?? name ?? '') + ':' + encodeURIComponent(metadata.entry ?? metadata.mode ?? 'folder');
  if (typeof name !== 'string' || !name) throw new TypeError('Recent workspace needs a name or entry');
  assertId(uri, 'Recent workspace URI');
  return {uri, label: name, kind: 'project', workspaceId: metadata.workspaceId};
}

function matches(item, metadata) {
  return Boolean(metadata && (metadata.name || metadata.label || metadata.entry || metadata.uri) &&
    recentWorkspaceItem(metadata).uri === item.uri);
}

function recoveryRecord(record) {
  if (!record || typeof record !== 'object') throw new TypeError('Invalid recovery file record');
  const path = validateItemPath(record.path ?? record.uri);
  if (typeof record.text !== 'string' && !(record.bytes instanceof Uint8Array) && typeof record.base64 !== 'string') {
    throw new TypeError('Recovery file has no text or bytes: ' + path);
  }
  return {...record, path};
}

async function decodeRecoveryBytes(base64, signal) {
  if (base64.length > 90_000_000 || base64.length % 4 !== 0) throw new RangeError('Invalid or oversized recovery base64');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(base64.length / 4 * 3 - padding);
  let written = 0;
  for (let offset = 0; offset < base64.length; offset += 65536) {
    signal?.throwIfAborted();
    const chunk = base64.slice(offset, offset + 65536);
    if (/[^A-Za-z0-9+/=]/u.test(chunk) || offset + 65536 < base64.length && chunk.includes('=')) {
      throw new TypeError('Invalid recovery base64');
    }
    let decoded;
    try { decoded = atob(chunk); } catch (cause) { throw new TypeError('Invalid recovery base64', {cause}); }
    for (let index = 0; index < decoded.length; index++) bytes[written++] = decoded.charCodeAt(index);
    if (offset % 262144 === 196608) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (written !== bytes.length) throw new TypeError('Recovery base64 length mismatch');
  return bytes;
}

/** Prepare a legacy recovery payload on explicit Open, preserving text encodings, BOMs, bytes and unsaved source overrides. */
export async function restoreRecentWorkspace(payload, {signal} = {}) {
  signal?.throwIfAborted();
  if (payload?.format !== 'sharpforge-project' || payload.version !== 1 || !Array.isArray(payload.files)) {
    throw new TypeError('Unsupported recent-workspace recovery format');
  }
  const disk = payload.diskRecords ?? payload.extraFiles ?? [];
  if (!Array.isArray(disk) || disk.length > 20000 || payload.files.length > 20000) throw new RangeError('Recovery file limit exceeded');
  const records = new Map();
  for (const record of disk) {
    const value = recoveryRecord(record);
    if (records.has(value.path)) throw new Error('Duplicate recovery file: ' + value.path);
    records.set(value.path, value);
  }
  const sourcePaths = new Set();
  for (const source of payload.files) {
    const value = recoveryRecord(source);
    if (sourcePaths.has(value.path)) throw new Error('Duplicate recovery source: ' + value.path);
    sourcePaths.add(value.path);
    records.set(value.path, {...records.get(value.path), ...value});
  }
  if (!records.size || records.size > 20000) throw new RangeError('Recovery workspace must contain 1–20000 files');
  let total = 0;
  for (const record of records.values()) {
    const textLength = record.text?.length ?? 0;
    const binaryLength = record.bytes?.byteLength ?? Math.ceil((record.base64?.length ?? 0) * .75);
    total += textLength + binaryLength;
    if (textLength > 134217728 || binaryLength > 67108864 || total > 200_000_000) throw new RangeError('Recovery workspace size limit exceeded');
  }
  if (payload.folders !== undefined && (!Array.isArray(payload.folders) || payload.folders.length > 20000)) {
    throw new RangeError('Recovery folder limit exceeded');
  }
  const folders = (payload.folders ?? []).map(validateItemPath);
  const settings = validateWorkspaceSettings({...payload, startup: payload.startupProject ?? payload.startup}, [...records.keys()]);
  for (const record of records.values()) {
    signal?.throwIfAborted();
    if (!(record.bytes instanceof Uint8Array) && typeof record.base64 === 'string') record.bytes = await decodeRecoveryBytes(record.base64, signal);
  }
  return {records: [...records.values()], options: {entry: payload.entry ?? null, startup: settings.startup,
    name: settings.name, folders, mode: settings.mode, configuration: settings.configuration,
    extensionConfig: settings.extensions, settings}};
}

/** Resolve recent projects through explicit host providers; cancelled or unconfirmed opens never dismiss the Start window. */
export function createRecentWorkspaces({recent, getCurrent, readRecovery, openRecords, loadSample, openFolder, activateCurrent}) {
  if (!recent?.add || typeof getCurrent !== 'function') throw new TypeError('Recent workspaces require MRU and current-metadata providers');
  const remember = (metadata = getCurrent()) => {
    const item = recentWorkspaceItem(metadata);
    recent.add(item);
    return item;
  };
  const confirmed = async (item, provider, args, signal) => {
    signal?.throwIfAborted();
    if (typeof provider !== 'function') throw new Error('Reopen this workspace through Open Project or Open Folder to grant file access');
    const result = await provider(...args);
    signal?.throwIfAborted();
    if (result === false || result === null) throw abortError('Recent workspace opening was cancelled');
    if (result !== true && result?.opened !== true && !matches(item, getCurrent())) {
      throw new Error('The workspace provider did not confirm opening ' + item.label);
    }
    recent.add(item);
    return true;
  };
  const open = async (item, {signal} = {}) => {
    signal?.throwIfAborted();
    if (item?.kind !== 'project') throw new TypeError('Expected a recent project or solution');
    assertId(item.uri, 'Recent workspace URI');
    if (matches(item, getCurrent())) return confirmed(item, activateCurrent, [item, {signal}], signal);
    if (item.uri.startsWith('sample:')) return confirmed(item, loadSample, [item.uri.slice(7), {signal}], signal);
    for (const slot of ['workspace', 'previous']) {
      const payload = await readRecovery?.(slot, {signal});
      signal?.throwIfAborted();
      if (!matches(item, payload)) continue;
      const {records, options} = await restoreRecentWorkspace(payload, {signal});
      return confirmed(item, openRecords, [records, {...options, signal}], signal);
    }
    return confirmed(item, openFolder, [item, {reason: 'permission-required', signal}], signal);
  };
  return {remember, open};
}
