import {captureExplorerRecord, explorerSource, prepareExplorerRecord} from '../explorer-records.js';
import {captureExplorerWorkspace, documentStateFor, releaseExplorerModels} from '../explorer-history.js';
import {studioDiskLimits} from '../workbench/workspace-limits.js';
import {mapExplorerPath, pathWithin, xmlWorkspacePath} from './guards.js';
import {parseXml} from '@sharpforge/project-system';

/** One operation owns its cancellation and identity checks through the final host adoption. */
export function explorerOperationSignal(commands, options = {}) {
  const signals = [commands.operationController?.signal, options.signal].filter(Boolean);
  return signals.length > 1 ? AbortSignal.any(signals) : signals[0];
}

export function assertExplorerOperationCurrent(commands, identity, signal) {
  if (commands.disposed) throw new DOMException('Explorer operation was cancelled', 'AbortError');
  if (signal?.aborted) throw signal.reason ?? new DOMException('Explorer operation was cancelled', 'AbortError');
  const context = commands.host.context();
  if (context.identity !== identity) throw new DOMException('Workspace changed or Explorer operation was cancelled', 'AbortError');
  if (context.readOnly) throw new Error('Stop debugging before changing files');
}

/** Journal snapshots retain immutable source roots and saved baselines, never mutable editor models. */
export function capturePreparedExplorerState(commands, context) {
  const state = captureExplorerWorkspace(commands, context);
  const dirty = new Set(context.dirty ?? []);
  for (const record of state.records) {
    if (state.documentStates.has(record.path)) continue;
    const document = documentStateFor(record, null, {changed: dirty.has(record.path)});
    if (document) state.documentStates.set(record.path, document);
  }
  return {...state, identity: context.identity, name: context.name, dirty: [...dirty],
    settings: context.settings, openDocuments: context.openDocuments};
}

export function validatePreparedExplorerContent(operation) {
  const explicitText = operation.text !== undefined;
  const source = explicitText ? null : explorerSource(operation.record);
  const text = explicitText ? operation.text : source ? null : operation.record?.text;
  if (explicitText && typeof text !== 'string') throw new TypeError('File text must be a string');
  const maximum = !explicitText && operation.record ? studioDiskLimits.maxFileBytes : 4 * 1024 * 1024;
  if ((source?.length ?? text?.length ?? 0) > maximum) throw new RangeError('Text item size limit exceeded');
  if (!xmlWorkspacePath(operation.path)) return;
  if (source && source.length > 4 * 1024 * 1024) throw new RangeError('XML mutation exceeds the parser input limit');
  const xml = source ? source.getText(0, source.length) : text;
  if (typeof xml !== 'string') throw new Error('XML mutation requires validated text: ' + operation.path);
  parseXml(xml);
}

function changedDocumentStates(before, operations) {
  const states = new Map(before.documentStates ?? []);
  const originals = new Map(before.records.map(record => [record.path, record]));
  for (const operation of operations) {
    const path = operation.path;
    if (operation.kind === 'create' || operation.kind === 'write') {
      if (!/\.cs$/i.test(path)) continue;
      const previous = states.get(path) ?? documentStateFor(originals.get(path) ?? {path});
      states.set(path, {...previous, uri: path, dirty: true,
        baseline: operation.kind === 'create' ? null : previous?.baseline ?? null,
        staleSave: operation.kind !== 'create' && !!previous?.staleSave});
    } else if (['rename', 'move', 'copy', 'delete'].includes(operation.kind)) {
      const selected = [...states].filter(([uri]) => pathWithin(uri, path));
      if (operation.kind !== 'delete') {
        for (const [uri, previous] of selected) {
          const next = operation.destination + uri.slice(path.length);
          states.set(next, {...previous, uri: next,
            baseline: operation.kind === 'copy' ? null : previous.baseline,
            dirty: operation.kind === 'copy' || previous.dirty,
            staleSave: operation.kind !== 'copy' && previous.staleSave});
        }
      }
      if (operation.kind !== 'copy') for (const [uri] of selected) states.delete(uri);
    }
  }
  return states;
}

function commitDocumentStates(value, transaction, restore, persistedPaths) {
  const previous = restore ? new Map(value.documentStates ?? []) :
    changedDocumentStates(transaction.before, transaction.operations);
  const states = new Map();
  const persisted = new Set(persistedPaths);
  for (const record of value.records) {
    let state = documentStateFor(record, previous.get(record.path));
    if (!state) continue;
    if (persisted.has(record.path)) state = Object.freeze({...state, baseline: state.source, dirty: false, staleSave: false});
    states.set(record.path, state);
  }
  return states;
}

function adoptedRecords(commands, records, created) {
  const existing = new Map(commands.context().records.map(record => [record.path, record]));
  const supplied = new Map((commands.currentOperation?.operations ?? [])
    .filter(operation => operation.record?.model).map(operation => [operation.path, operation.record]));
  return records.map(record => {
    const source = explorerSource(record);
    const candidate = [existing.get(record.path), supplied.get(record.path)].find(value => value?.model &&
      value.model.uri === record.path && explorerSource(value) === source &&
      value.encoding === record.encoding && !!value.bom === !!record.bom);
    const prepared = prepareExplorerRecord(candidate ?? record, record.path);
    if (prepared.model && prepared.model !== candidate?.model) created.add(prepared.model);
    return prepared;
  });
}

/** Attach editor ownership only at the journal's host boundary; the receipt continues to contain immutable records. */
export async function commitPreparedExplorerState(commands, value, options = {}) {
  const current = commands.currentOperation;
  const identity = current?.identity ?? value.identity;
  assertExplorerOperationCurrent(commands, identity, current?.signal);
  current?.validate?.();
  const transaction = options.transaction;
  const mappings = options.restore ? [] : commands.currentMappings ?? [];
  const persistedPaths = transaction.completedMutations.filter(operation => operation.kind === 'write').map(operation => operation.path);
  const documentStates = commitDocumentStates(value, transaction, options.restore, persistedPaths);
  const dirty = new Set(value.dirty ?? []);
  for (const [path, state] of documentStates) state.dirty ? dirty.add(path) : dirty.delete(path);
  for (const path of persistedPaths) dirty.delete(path);
  const created = new Set();
  let records = [];
  let committed = false;
  try {
    records = adoptedRecords(commands, value.records, created);
    commands.host.explorer?.prepareMappings?.(mappings);
    const prepared = {...value, records, mappings, documentStates, dirty: [...dirty], restore: options.restore,
      diskCommitted: !!transaction.completedMutations.length, persistedPaths,
      entry: options.restore?.entry ?? mapExplorerPath(value.entry, mappings), validate: current?.validate};
    try {
      const result = await commands.host.commit(prepared);
      if (result?.committed === false) throw new Error('The workspace declined the file operation');
      committed = true;
    } catch (error) {
      committed = error.committed === true;
      throw error;
    }
  } finally {
    if (committed) {
      transaction.after.documentStates = new Map(documentStates);
      transaction.after.dirty = [...dirty];
    }
    releaseExplorerModels(commands, created, {committed, records});
  }
}

/** Preserve the original Explorer inspection shape while one journal stack owns undo and redo. */
export function synchronizeExplorerHistory(commands) {
  commands.history = commands.fileHistory.undoStack.map(entry => {
    const after = entry.after.records.map(record => captureExplorerRecord(record));
    Object.defineProperty(after, 'records', {value: entry.after.records});
    return {...entry, after, afterState: entry.after};
  });
}
