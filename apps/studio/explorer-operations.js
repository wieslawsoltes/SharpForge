import { ExplorerTransaction } from './explorer-transaction.js';
import { nativeExplorerOperation } from './explorer-existing.js';
import { pushExplorerHistory, previewHistory, releaseExplorerModels, validateExplorerUndo, prepareExplorerUndo } from './explorer-history.js';

async function nativeOperation(owner, context, operations, mappings) {
  const plan = operations.map(nativeExplorerOperation);
  await owner.host.saveNative();
  for (const [path, text] of owner.readSet ?? []) {
    if ((await context.client.read(path)).text !== text) {
      throw new Error('Project changed while preparing the operation; no file operations applied: ' + path);
    }
  }
  for (const operation of plan) if (!['create', 'mkdir'].includes(operation.kind)) {
    operation.expectedHash = (await context.client.inspectItem(operation.path)).hash;
  }
  let result;
  try { result = await context.client.mutate(plan); }
  catch (error) {
    if (error.undoToken) pushExplorerHistory(owner, { native: true, token: error.undoToken, mappings });
    await owner.host.refreshNative([], true);
    throw error;
  }
  pushExplorerHistory(owner, { native: true, token: result.undoToken, mappings });
  await owner.host.refreshNative(mappings);
  owner.host.notice('Disk operation completed. Undo is available; multi-file operations are not atomic.');
}

async function previewOperation(owner, context, operations, mappings, options) {
  for (const [path, text] of owner.readSet ?? []) if (context.records.find(record => record.path === path)?.text !== text) {
    throw new Error('Project changed while preparing the operation: ' + path);
  }
  const transaction = new ExplorerTransaction(owner, context);
  let prepared;
  let committed = false;
  try {
    prepared = transaction.prepare(operations, mappings);
    if (options.validate) {
      if (typeof options.validate !== 'function') throw new TypeError('The Explorer commit guard must be a function');
      prepared.validate = options.validate;
      prepared.validate();
    }
    try {
      const result = await owner.host.commit(prepared);
      if (result?.committed === false) throw new Error('The workspace declined the file operation');
      committed = true;
    } catch (error) {
      committed = error.committed === true;
      throw error;
    }
  } finally {
    if (committed) pushExplorerHistory(owner, previewHistory(owner, transaction.before, prepared.folders));
    releaseExplorerModels(owner, transaction.created, { committed, records: prepared?.records ?? [] });
  }
}

/** Run a completed file plan through one native or browser commit boundary, with explicit source-model ownership. */
export async function performExplorerOperation(owner, operations, mappings = [], options = {}) {
  const context = owner.context();
  if (owner.operationIdentity && context.identity !== owner.operationIdentity) {
    throw new Error('Workspace changed while preparing the file operation');
  }
  owner.busy = true;
  owner.host.render();
  try {
    if (context.native) return await nativeOperation(owner, context, operations, mappings);
    return await previewOperation(owner, context, operations, mappings, options);
  } finally {
    owner.busy = false;
    owner.host.render();
  }
}

export async function undoExplorerOperation(owner) {
  if (!owner.history.length) throw new Error('No file operation to undo');
  const entry = owner.history.at(-1);
  const context = owner.context();
  owner.busy = true;
  owner.host.render();
  try {
    if (entry.native) {
      if (!context.native) throw new Error('This undo belongs to a native workspace');
      await owner.host.saveNative();
      await context.client.undoMutation(entry.token);
      owner.history.pop();
      await owner.host.refreshNative(entry.mappings.map(mapping => ({ from: mapping.to, to: mapping.from })));
    } else {
      validateExplorerUndo(entry, context);
      const created = new Set();
      let prepared;
      let committed = false;
      try {
        prepared = prepareExplorerUndo(entry, context, created);
        try {
          const result = await owner.host.commit(prepared);
          if (result?.committed === false) throw new Error('The workspace declined the undo operation');
          committed = true;
        } catch (error) {
          committed = error.committed === true;
          throw error;
        }
      } finally {
        if (committed) owner.history.pop();
        releaseExplorerModels(owner, created, { committed, records: prepared?.records ?? [] });
      }
    }
    owner.host.notice('File operation undone.');
  } finally {
    owner.busy = false;
    owner.host.render();
  }
}
