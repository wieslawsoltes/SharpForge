import {workspaceRecordSource, cloneWorkspaceDocumentStates} from '../transaction-records.js';
import {sanitizeRecoveryValue} from './sanitize.js';

const recordFields = ['records', 'diskRecords', 'files', 'documents', 'extraFiles'];

/** Sanitize record metadata without evaluating a prepared document's compatibility text getter or retaining its model. */
export function sanitizeRecoveryRecord(record) {
  if (!record || typeof record !== 'object') return sanitizeRecoveryValue(record);
  const source = workspaceRecordSource(record);
  const metadata = {};
  for (const key of Object.keys(record)) {
    if (['model', 'source', 'originalSource'].includes(key) || source && key === 'text') continue;
    metadata[key] = record[key];
  }
  const clean = sanitizeRecoveryValue(metadata);
  if (source) Object.defineProperty(clean, 'source', {value: source, configurable: true});
  const originalSource = workspaceRecordSource({source: record.originalSource});
  if (originalSource) Object.defineProperty(clean, 'originalSource', {value: originalSource, configurable: true});
  return clean;
}

/** Only immutable source roots survive migration; all settings and per-document metadata retain the normal secret filter. */
export function sanitizeRecoveryInput(input) {
  const metadata = {};
  for (const key of Object.keys(input)) {
    if (!recordFields.includes(key) && key !== 'documentStates') metadata[key] = input[key];
  }
  const clean = sanitizeRecoveryValue(metadata);
  for (const key of recordFields) {
    const value = input[key];
    if (value === undefined) continue;
    clean[key] = Array.isArray(value) ? value.map(sanitizeRecoveryRecord) :
      key === 'files' && value && typeof value === 'object' ?
        Object.fromEntries(Object.entries(value).map(([path, record]) => [path, sanitizeRecoveryRecord(record)])) :
        sanitizeRecoveryValue(value);
  }
  if (input.documentStates !== undefined) {
    clean.documentStates = new Map();
    for (const [path, state] of cloneWorkspaceDocumentStates(input.documentStates)) {
      const {source, baseline, ...details} = state;
      clean.documentStates.set(path, Object.freeze({...sanitizeRecoveryValue(details), source, baseline}));
    }
  }
  return clean;
}
