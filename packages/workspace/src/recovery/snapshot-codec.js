import {PieceTable} from '@sharpforge/text';
import {workspaceRecordSource, cloneWorkspaceRecordSnapshot} from '../transaction-records.js';
import {throwIfWorkspaceAborted} from '../content-hash.js';
import {validateWorkspacePath} from '../transaction-state.js';
import {sanitizeRecoveryRecord} from './prepared-records.js';
import {sanitizeRecoveryValue} from './sanitize.js';

const CHUNK_LENGTH = 65536;
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const invalid = message => new Error('SFW1302: ' + message);

function recordMetadata(record) {
  const clean = sanitizeRecoveryRecord(record);
  const result = {};
  for (const key of Object.keys(clean)) {
    if (!['sourceRef', 'originalSourceRef'].includes(key)) result[key] = clean[key];
  }
  return result;
}

/** Version-two envelopes preserve shared immutable roots as bounded UTF-16 chunks, with no editor/model serialization. */
export async function encodeRecoverySnapshots(value, {maxBytes = 128 * 1024 * 1024, maxFiles = 20000, signal} = {}) {
  const snapshots = [];
  const references = new Map();
  let sourceBytes = 0;
  const reference = async source => {
    if (source == null) return null;
    if (workspaceRecordSource({source}) !== source) throw invalid('Recovery requires immutable source snapshots');
    if (!Number.isSafeInteger(source.version) || source.version < 0) throw invalid('Recovery source version is invalid');
    validateWorkspacePath(source.uri);
    if (references.has(source)) return references.get(source);
    if (snapshots.length >= maxFiles * 3) throw new Error('SFW1304: Recovery source count limit exceeded');
    sourceBytes += source.length * 2;
    if (sourceBytes > maxBytes) throw new Error('SFW1304: Recovery source byte limit exceeded');
    const entry = {uri: source.uri, version: source.version, length: source.length, chunks: []};
    const index = snapshots.length;
    references.set(source, index);
    snapshots.push(entry);
    for (let start = 0; start < source.length; start += CHUNK_LENGTH) {
      throwIfWorkspaceAborted(signal);
      const end = Math.min(source.length, start + CHUNK_LENGTH);
      const text = source.getText(start, end);
      if (typeof text !== 'string' || text.length !== end - start) throw invalid('Source snapshot returned an invalid range');
      entry.chunks.push(text);
      await pause();
    }
    return index;
  };
  const records = [];
  for (const record of value.records) {
    throwIfWorkspaceAborted(signal);
    const metadata = recordMetadata(record);
    const source = workspaceRecordSource(record);
    if (source) {
      metadata.sourceRef = await reference(source);
      if (record.originalSource) metadata.originalSourceRef = await reference(record.originalSource);
    }
    records.push(metadata);
  }
  const documentStates = [];
  for (const [path, state] of value.documentStates ?? []) {
    const {source, baseline, ...metadata} = state;
    for (const key of ['sourceRef', 'sourceText', 'baselineRef', 'baselineText']) delete metadata[key];
    documentStates.push({...sanitizeRecoveryValue(metadata), path,
      ...(typeof source === 'string' ? {sourceText: source} : {sourceRef: await reference(source)}),
      ...(typeof baseline === 'string' ? {baselineText: baseline} : {baselineRef: await reference(baseline)})});
  }
  throwIfWorkspaceAborted(signal);
  return {...value, records, documentStates, sourceSnapshots: snapshots};
}

async function decodeSources(input, {maxBytes, maxFiles, signal}) {
  if (!Array.isArray(input) || input.length > maxFiles * 3) throw invalid('Recovery source table is invalid');
  const sources = [];
  let total = 0;
  for (const entry of input) {
    throwIfWorkspaceAborted(signal);
    if (!entry || !Number.isSafeInteger(entry.length) || entry.length < 0 || !Number.isSafeInteger(entry.version)
        || entry.version < 0 || !Array.isArray(entry.chunks) || entry.chunks.length !== Math.ceil(entry.length / CHUNK_LENGTH)) {
      throw invalid('Recovery source header is invalid');
    }
    total += entry.length * 2;
    if (total > maxBytes) throw new Error('SFW1304: Recovery source byte limit exceeded');
    const uri = validateWorkspacePath(entry.uri);
    const table = new PieceTable('', {uri, version: entry.version});
    let length = 0;
    for (const chunk of entry.chunks) {
      if (typeof chunk !== 'string' || chunk.length !== Math.min(CHUNK_LENGTH, entry.length - length)) {
        throw invalid('Recovery source chunk is invalid');
      }
      table.insert(length, chunk);
      length += chunk.length;
      await pause();
      throwIfWorkspaceAborted(signal);
    }
    sources.push(table.snapshot().withMetadata({uri, version: entry.version}));
  }
  return sources;
}

/** Rebuild persistent roots before normal schema validation; invalid references never become invented empty documents. */
export async function decodeRecoverySnapshots(value, {maxBytes = 128 * 1024 * 1024, maxFiles = 20000, signal} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxFiles) || maxFiles < 0) {
    throw new Error('SFW1304: Recovery limits must be non-negative safe integers');
  }
  const sources = await decodeSources(value.sourceSnapshots, {maxBytes, maxFiles, signal});
  const reference = index => {
    if (index === null) return null;
    if (!Number.isSafeInteger(index) || index < 0 || index >= sources.length) throw invalid('Recovery source reference is invalid');
    return sources[index];
  };
  if (!Array.isArray(value.records) || value.records.length > maxFiles) throw invalid('Recovery records are invalid');
  const records = value.records.map(input => {
    const {sourceRef, originalSourceRef, ...record} = input;
    if (sourceRef === undefined) return record;
    const source = reference(sourceRef);
    if (!source || source.uri !== record.path) throw invalid('Recovery source path does not match its record');
    Object.defineProperty(record, 'source', {value: source});
    if (originalSourceRef !== undefined) Object.defineProperty(record, 'originalSource', {value: reference(originalSourceRef)});
    return cloneWorkspaceRecordSnapshot(record);
  });
  if (!Array.isArray(value.documentStates) || value.documentStates.length > maxFiles) throw invalid('Recovery document states are invalid');
  const documentStates = new Map();
  for (const entry of value.documentStates) {
    const {path, sourceRef, baselineRef, sourceText, baselineText, ...metadata} = entry;
    validateWorkspacePath(path);
    if (documentStates.has(path)) throw invalid('Duplicate recovery document state');
    if (sourceText !== undefined && typeof sourceText !== 'string' || baselineText !== undefined && typeof baselineText !== 'string') {
      throw invalid('Recovery document text is invalid');
    }
    documentStates.set(path, Object.freeze({...metadata,
      source: sourceText ?? reference(sourceRef), baseline: baselineText ?? reference(baselineRef)}));
  }
  const {sourceSnapshots, ...metadata} = value;
  return {...metadata, records, documentStates};
}
