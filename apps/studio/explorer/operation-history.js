import {WorkspaceTransactionJournal, FileOperationHistory} from '@sharpforge/workspace';
import {decodeWorkspaceFile} from '@sharpforge/archive';
import {nativeExplorerOperation} from '../explorer-existing.js';
import {studioDiskLimits} from '../workbench/workspace-limits.js';
import {ExplorerSourceTransactionAdapter} from './source-admission.js';
import {assertExplorerOperationCurrent, capturePreparedExplorerState, commitPreparedExplorerState,
  explorerOperationSignal, synchronizeExplorerHistory, validatePreparedExplorerContent} from './prepared-operations.js';

export function captureExplorerState(context, commands = {host: {}}) {
  return capturePreparedExplorerState(commands, context);
}

function normalizeOperations(operations) {
  return operations.map(operation => {
    if (operation.base64 === undefined) return operation;
    if (typeof operation.base64 !== 'string' || operation.base64.length > 24 * 1024 * 1024 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(operation.base64)) {
      throw new Error('Invalid/oversized binary item');
    }
    const bytes = Uint8Array.from(atob(operation.base64), character => character.charCodeAt(0));
    return {...operation, bytes, record: decodeWorkspaceFile(operation.path, bytes)};
  });
}

export function createExplorerHistory(commands) {
  const journal = new WorkspaceTransactionJournal({
    getState: () => captureExplorerState(commands.context(), commands),
    commitState: (value, options) => commitPreparedExplorerState(commands, value, options),
    adapter: new ExplorerSourceTransactionAdapter({getWorkspace: () => commands.context().disk,
      ready: () => commands.host.explorer?.persistence?.ready(), maxBytes: studioDiskLimits.maxTotalBytes}),
    validateContent: validatePreparedExplorerContent,
    limits: {maxFiles: studioDiskLimits.maxFiles, maxBytes: studioDiskLimits.maxTotalBytes * 2},
    store: commands.host.journalStore ?? {save: receipt => commands.host.explorer?.persistence?.saveReceipt(receipt)}
  });
  // Large prepared source roots are shared; permit one bounded before/after workspace without dropping its undo.
  return new FileOperationHistory(journal, {maxBytes: studioDiskLimits.maxTotalBytes * 4, maxEntries: 32});
}

/** Native host owns disk admission and quarantine; keep unsaved buffers intact if a partial host operation fails. */
async function performNative(commands, operations, mappings) {
  const context = commands.context();
  const current = commands.currentOperation;
  const nativeOperations = operations.map(operation => {
    const prepared = operation.record || operation.bytes ?
      {...operation, record: operation.record ?? {path: operation.path, bytes: operation.bytes}} : operation;
    const value = nativeExplorerOperation(prepared);
    delete value.bytes;
    return value;
  });
  await commands.host.saveNative();
  assertExplorerOperationCurrent(commands, current.identity, current.signal);
  for (const [path, text] of commands.readSet ?? []) {
    if ((await context.client.read(path, {signal: current.signal})).text !== text) {
      throw new Error('Project changed while preparing the operation; no file operations applied: ' + path);
    }
  }
  for (const value of nativeOperations) {
    assertExplorerOperationCurrent(commands, current.identity, current.signal);
    if (!['create', 'mkdir'].includes(value.kind)) value.expectedHash = (await context.client.inspectItem(value.path)).hash;
  }
  assertExplorerOperationCurrent(commands, current.identity, current.signal);
  current.validate?.();
  let result;
  try { result = await context.client.mutate(nativeOperations); }
  catch (error) {
    if (error.undoToken) commands.history.push({native: true, token: error.undoToken, mappings, operations: nativeOperations});
    commands.host.notice('File operation failed. Unsaved buffers were retained. Completed changes: ' +
      (error.completedMutations?.map(operation => operation.path).join(', ') ?? error.written?.join(', ') ?? 'see host error'));
    throw error;
  }
  commands.history.push({native: true, token: result.undoToken, mappings, operations: nativeOperations});
  while (commands.history.length > 32) commands.history.shift();
  await commands.host.refreshNative(mappings);
  commands.host.notice('Disk operation completed. Undo is available; multi-file disk writes report per-file completion.');
  return result;
}

export async function performExplorerOperations(commands, operations, mappings = [], options = {}) {
  const context = commands.context();
  if (!Array.isArray(operations) || operations.length > 20_000) throw new RangeError('Invalid explorer operation count');
  if (options.validate !== undefined && typeof options.validate !== 'function') throw new TypeError('The Explorer commit guard must be a function');
  if (commands.operationIdentity && context.identity !== commands.operationIdentity) {
    throw new Error('Workspace changed while preparing the file operation');
  }
  const signal = explorerOperationSignal(commands, options);
  assertExplorerOperationCurrent(commands, context.identity, signal);
  commands.busy = true;
  commands.currentMappings = mappings;
  commands.currentOperation = {identity: context.identity, signal, validate: options.validate, operations};
  let committed = false;
  try {
    commands.host.render();
    options.validate?.();
    for (const [path, text] of commands.readSet ?? []) {
      if (!context.native && context.records.find(file => file.path === path)?.text !== text) {
        throw new Error('Project changed while preparing the operation: ' + path);
      }
    }
    const normalized = normalizeOperations(operations);
    commands.currentOperation.operations = normalized;
    if (context.native) return await performNative(commands, normalized, mappings);
    const receipt = await commands.fileHistory.execute(normalized, {signal, label: options.label});
    committed = true;
    synchronizeExplorerHistory(commands);
    commands.host.explorer?.remapSelection?.(mappings);
    await commands.host.recovery?.checkpoint?.(commands.context());
    return receipt;
  } catch (error) {
    if (committed) error.committed = true;
    throw error;
  } finally {
    if (!context.native) synchronizeExplorerHistory(commands);
    commands.currentMappings = [];
    commands.currentOperation = null;
    commands.busy = false;
    commands.host.render();
  }
}

export async function undoExplorerOperation(commands, redo = false) {
  const context = commands.context();
  const signal = explorerOperationSignal(commands);
  assertExplorerOperationCurrent(commands, context.identity, signal);
  commands.busy = true;
  commands.currentOperation = {identity: context.identity, signal, operations: []};
  commands.host.render();
  try {
    if (!context.native) {
      const receipt = await (redo ? commands.fileHistory.redo({signal}) : commands.fileHistory.undo({signal}));
      synchronizeExplorerHistory(commands);
      commands.host.notice('File operation ' + (redo ? 'redone.' : 'undone.'));
      return receipt;
    }
    if (redo) throw new Error('Native file redo requires a fresh reviewed mutation; browser workspace redo is supported');
    const record = commands.history.at(-1);
    if (!record) throw new Error('No file operation to undo');
    await commands.host.saveNative();
    await context.client.undoMutation(record.token);
    commands.history.pop();
    await commands.host.refreshNative(record.mappings.map(mapping => ({from: mapping.to, to: mapping.from})));
    commands.host.notice('File operation undone.');
  } finally {
    if (!context.native) synchronizeExplorerHistory(commands);
    commands.currentOperation = null;
    commands.busy = false;
    commands.host.render();
  }
}
