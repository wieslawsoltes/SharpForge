import {WorkspaceTransactionJournal, FileOperationHistory, ProviderTransactionAdapter} from '@sharpforge/workspace';
import {decodeWorkspaceFile, encodeWorkspaceFile} from '@sharpforge/archive';
import {parseXml} from '@sharpforge/project-system';
import {mapExplorerPath, xmlWorkspacePath} from './guards.js';

export function captureExplorerState(context) {
  return {identity: context.identity, name: context.name, records: context.records, folders: context.folders ?? [],
    active: context.active, tabs: context.tabs ?? [], breakpoints: context.breakpoints ?? {},
    dirty: context.dirty ?? [], startup: context.startup, entry: context.solutionPath ?? context.entry};
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

function binaryBase64(bytes) {
  let text = '';
  for (let index = 0; index < bytes.length; index += 32768) text += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return btoa(text);
}

export function createExplorerHistory(commands) {
  const journal = new WorkspaceTransactionJournal({
    getState: () => captureExplorerState(commands.context()),
    commitState: async (value, options = {}) => {
      if (commands.operationIdentity && commands.context().identity !== commands.operationIdentity) {
        throw new Error('Workspace changed while committing the file operation');
      }
      const mappings = options.restore ? [] : commands.currentMappings ?? [];
      commands.host.explorer?.prepareMappings?.(mappings);
      await commands.host.commit({...value, mappings, restore: options.restore,
        diskCommitted: !!options.transaction?.completedMutations.length,
        persistedPaths: options.transaction?.completedMutations.filter(operation => operation.kind === 'write').map(operation => operation.path) ?? [],
        entry: options.restore?.entry ?? mapExplorerPath(value.entry, mappings)});
    },
    adapter: new ProviderTransactionAdapter({getWorkspace: () => commands.context().disk,
      ready: () => commands.host.explorer?.persistence?.ready()}),
    validateContent: operation => {
      const text = operation.text ?? operation.record?.text;
      if (typeof text === 'string' && text.length > 4 * 1024 * 1024) throw new Error('Text item size limit exceeded');
      if (xmlWorkspacePath(operation.path)) {
        if (typeof text !== 'string') throw new Error('XML mutation requires validated text: ' + operation.path);
        parseXml(text);
      }
    },
    store: commands.host.journalStore ?? {save: receipt => commands.host.explorer?.persistence?.saveReceipt(receipt)}
  });
  return new FileOperationHistory(journal);
}

/** Native host owns disk admission and quarantine; keep unsaved buffers intact if a partial host operation fails. */
async function performNative(commands, operations, mappings) {
  const context = commands.context();
  await commands.host.saveNative();
  for (const [path, text] of commands.readSet ?? []) {
    if ((await context.client.read(path)).text !== text) throw new Error('Project changed while preparing the operation; no file operations applied: ' + path);
  }
  const nativeOperations = [];
  for (const operation of operations) {
    const value = {...operation};
    if (value.record || value.bytes) {
      const record = value.record ?? {path: value.path, bytes: value.bytes};
      value.base64 = binaryBase64(encodeWorkspaceFile(record));
      delete value.record;
      delete value.bytes;
    }
    if (!['create', 'mkdir'].includes(value.kind)) value.expectedHash = (await context.client.inspectItem(value.path)).hash;
    nativeOperations.push(value);
  }
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

export async function performExplorerOperations(commands, operations, mappings = []) {
  const context = commands.context();
  if (commands.operationIdentity && context.identity !== commands.operationIdentity) {
    throw new Error('Workspace changed while preparing the file operation');
  }
  commands.busy = true;
  commands.currentMappings = mappings;
  commands.host.render();
  try {
    for (const [path, text] of commands.readSet ?? []) {
      if (!context.native && context.records.find(file => file.path === path)?.text !== text) {
        throw new Error('Project changed while preparing the operation: ' + path);
      }
    }
    const normalized = normalizeOperations(operations);
    if (context.native) return await performNative(commands, normalized, mappings);
    const receipt = await commands.fileHistory.execute(normalized);
    commands.history = commands.fileHistory.undoStack;
    commands.host.explorer?.remapSelection?.(mappings);
    await commands.host.recovery?.checkpoint?.(commands.context());
    return receipt;
  } finally {
    commands.currentMappings = [];
    commands.busy = false;
    commands.host.render();
  }
}

export async function undoExplorerOperation(commands, redo = false) {
  const context = commands.context();
  commands.busy = true;
  commands.host.render();
  try {
    if (!context.native) {
      const receipt = await (redo ? commands.fileHistory.redo() : commands.fileHistory.undo());
      commands.history = commands.fileHistory.undoStack;
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
    commands.busy = false;
    commands.host.render();
  }
}
