import {prepareWorkspaceSourceBuffers} from './workspace-documents.js';

const versionOf = record => record.version ?? 1;
const readOnly = (state, record) => state.readOnly || record.readOnly || record.generated;

function assertWritable(host, record) {
  if (!record || !/\.cs$/i.test(record.path ?? record.uri)) throw new Error('Cannot edit a missing or generated document');
  if ((host.isReadOnly ?? (value => readOnly(host.state, value)))(record)) {
    throw new Error('This source document is read-only');
  }
}

/** Validate the entire action against worker snapshots before admitting any closed source buffer or changing text. */
export async function applyWorkspaceRefactoring(host, action) {
  if (!action || !Array.isArray(action.edits)) throw new TypeError('A versioned refactoring action is required');
  if (action.edits.length > 10000) throw new RangeError('Refactoring edit-count limit exceeded');
  const captured = {...action, edits: action.edits.map(edit => ({...edit}))};
  const context = host.context();
  const records = new Map(context.records.map(record => [record.path, record]));
  const expected = new Map();
  for (const edit of captured.edits) {
    const record = records.get(edit.uri);
    assertWritable(host, record);
    if (versionOf(record) !== edit.version) throw new Error('The refactoring is stale. Request it again.');
    expected.set(edit.uri, record);
  }
  if (!expected.size) return {changes: []};
  const validated = await host.request('validateRefactoring', {action: captured});
  const current = host.context();
  if (context.identity !== current.identity || context.disk !== current.disk || context.revision !== current.revision) {
    throw new Error('Source changed during refactoring validation; no edits were applied');
  }
  const latest = new Map(current.records.map(record => [record.path, record]));
  const admitted = [];
  const visited = new Set();
  if (!Array.isArray(validated?.changes)) throw new Error('Refactoring validation returned an invalid snapshot');
  for (const change of validated.changes) {
    const record = latest.get(change.uri);
    const before = expected.get(change.uri);
    assertWritable(host, record);
    if (!before || visited.has(change.uri) || versionOf(record) !== versionOf(before) ||
        typeof record.text !== 'string' || record.text !== change.previous ||
        typeof before.text === 'string' && before.text !== record.text ||
        typeof change.text !== 'string' || change.version !== versionOf(record) + 1) {
      throw new Error('Refactoring snapshot mismatch');
    }
    visited.add(change.uri);
    admitted.push(record);
  }
  if (visited.size !== expected.size) throw new Error('Refactoring validation omitted a source snapshot');
  const files = prepareWorkspaceSourceBuffers(host.state, admitted);
  host.state.files = files;
  host.applyEdits(captured.edits);
  return validated;
}
