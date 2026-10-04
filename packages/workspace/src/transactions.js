import {throwIfWorkspaceAborted} from './content-hash.js';
import {cloneWorkspaceState, validateWorkspaceState, applyWorkspaceOperation, hashWorkspaceState,
  hashWorkspaceRecord} from './transaction-state.js';
import {cloneWorkspaceOperation} from './transaction-records.js';

export class WorkspaceTransactionError extends Error {
  constructor(message, receipt, cause) {
    super(message, {cause});
    this.name = 'WorkspaceTransactionError';
    this.code = 'SFW1110';
    this.receipt = receipt;
    this.completedMutations = receipt.completedMutations;
    this.written = receipt.completedMutations.map(operation => operation.destination ?? operation.path);
    this.committed = receipt.status.startsWith('committed');
  }
}

/** Ordered write-ahead journal. Memory commits atomically; disk partial completion is explicit and recoverable. */
export class WorkspaceTransactionJournal {
  constructor({getState, commitState, adapter = null, store = null, validateContent = null, limits = {}}) {
    if (typeof getState !== 'function' || typeof commitState !== 'function') throw new TypeError('Workspace state callbacks are required');
    Object.assign(this, {getState, commitState, adapter, store, validateContent, limits});
    this.active = false;
    this.disposed = false;
    this.sequence = 0;
    this.receipts = [];
  }

  begin({label = 'Workspace operation', signal, targetState = null} = {}) {
    if (this.disposed) throw new Error('SFW1111: Transaction journal is disposed');
    throwIfWorkspaceAborted(signal);
    return new WorkspaceTransaction(this, {label, signal, targetState, id: ++this.sequence});
  }

  async execute(operations, options = {}) {
    const transaction = this.begin(options);
    for (const operation of operations) transaction.add(operation);
    return transaction.commit();
  }

  async persist(receipt) {
    if (this.store) await this.store.save(receipt);
  }

  async commit(transaction) {
    if (this.active) throw new Error('SFW1112: A workspace transaction is already committing');
    if (this.disposed) throw new Error('SFW1111: Transaction journal is disposed');
    this.active = true;
    try {
      return this.adapter?.run ? await this.adapter.run(({signal = transaction.signal} = {}) =>
        this.commitExclusive({...transaction, signal}), {signal: transaction.signal})
        : await this.commitExclusive(transaction);
    }
    finally { this.active = false; }
  }

  async commitExclusive(transaction) {
    const {signal, label, id} = transaction;
    throwIfWorkspaceAborted(signal);
    const original = cloneWorkspaceState(this.getState());
    const originalHash = await hashWorkspaceState(original, {signal});
    const before = this.adapter?.snapshot ? await this.adapter.snapshot(original, transaction.operations, {signal}) : original;
    validateWorkspaceState(before, this.limits);
    const after = cloneWorkspaceState(before);
    const receipt = {version: 1, id, label, status: 'prepared', operations: [], completedMutations: [], before, after};
    for (const operation of transaction.operations) {
      const previous = after.records.find(record => record.path === operation.path);
      const beforeHash = previous ? await hashWorkspaceRecord(previous, {signal}) : null;
      if (operation.expectedHash !== undefined && operation.expectedHash !== beforeHash) {
        throw new Error('SFW1113: Content changed before transaction: ' + operation.path);
      }
      if (['create', 'write'].includes(operation.kind)) await this.validateContent?.(operation, {signal});
      applyWorkspaceOperation(after, operation);
      const next = after.records.find(record => record.path === (operation.destination ?? operation.path));
      const afterHash = next ? await hashWorkspaceRecord(next, {signal}) : null;
      receipt.operations.push({...operation, beforeHash, afterHash});
    }
    validateWorkspaceState(after, this.limits);
    if (transaction.targetState) {
      if (await hashWorkspaceState(after, {signal}) !== await hashWorkspaceState(transaction.targetState, {signal})) {
        throw new Error('SFW1115: Transaction plan does not produce the requested restore state');
      }
      Object.assign(after, cloneWorkspaceState(transaction.targetState));
    }
    throwIfWorkspaceAborted(signal);
    await this.adapter?.preflight?.(receipt.operations, {signal, before, after});
    if (await hashWorkspaceState(this.getState(), {signal}) !== originalHash) {
      throw new Error('SFW1113: Workspace changed during transaction preparation');
    }
    await this.persist(receipt);
    try {
      for (const operation of receipt.operations) {
        throwIfWorkspaceAborted(signal);
        if (this.adapter) {
          const result = await this.adapter.apply(operation, {signal, onCompleted: async mutation => {
            receipt.completedMutations.push(mutation);
            await this.persist(receipt);
          }});
          if (!result?.reported && !result?.skipped) {
            receipt.completedMutations.push(...(result?.completedMutations ?? [operation]));
            await this.persist(receipt);
          }
        }
      }
      throwIfWorkspaceAborted(signal);
      if (await hashWorkspaceState(this.getState(), {signal}) !== originalHash) {
        throw new Error('SFW1113: Unsaved buffers changed while disk operations were running');
      }
      await this.adopt(receipt, transaction);
      await this.persist(receipt);
      this.receipts.push(receipt);
      while (this.receipts.length > 32) this.receipts.shift();
      return receipt;
    } catch (cause) {
      receipt.status = receipt.status === 'committed' ? 'committed-storage-failure' :
        receipt.status.startsWith('committed-') ? receipt.status : 'failed';
      receipt.completedMutations.push(...(cause.completedMutations ?? []));
      receipt.error = {message: cause.message, code: cause.code ?? cause.name};
      try { await this.persist(receipt); }
      catch (storageError) { receipt.storageError = storageError.message; }
      this.receipts.push(receipt);
      while (this.receipts.length > 32) this.receipts.shift();
      throw new WorkspaceTransactionError(
        (receipt.status.startsWith('committed') ? 'Workspace transaction committed with an error; ' : 'Workspace transaction failed; ')
          + 'completed disk mutations: ' + receipt.completedMutations.length + '. ' + cause.message,
        receipt, cause);
    }
  }

  async adopt(receipt, transaction) {
    let observerError = null;
    try {
      await this.commitState(cloneWorkspaceState(receipt.after), {transaction: receipt,
        restore: transaction.targetState ? cloneWorkspaceState(receipt.after) : null});
    } catch (error) {
      // The host owns adoption. A later observer failure cannot undo it or cause a second admission.
      if (!error.committed) throw error;
      observerError = error;
    }
    receipt.status = 'committed';
    try { await this.adapter?.finalize?.(receipt); }
    catch (error) {
      receipt.status = 'committed-adapter-failure';
      throw error;
    }
    if (observerError) {
      receipt.status = 'committed-observer-failure';
      throw observerError;
    }
  }

  dispose() { this.disposed = true; }
}

export class WorkspaceTransaction {
  constructor(journal, options) {
    Object.assign(this, options);
    this.journal = journal;
    this.operations = [];
    this.status = 'open';
  }

  add(operation) {
    if (this.status !== 'open') throw new Error('SFW1114: Transaction is no longer open');
    if (this.operations.length >= 20000) throw new RangeError('SFW1102: Transaction operation limit exceeded');
    this.operations.push(cloneWorkspaceOperation(operation));
    return this;
  }

  async commit() {
    if (this.status !== 'open') throw new Error('SFW1114: Transaction is no longer open');
    this.status = 'committing';
    try {
      const receipt = await this.journal.commit(this);
      this.status = 'committed';
      return receipt;
    } catch (error) {
      this.status = error.committed ? 'committed' : 'failed';
      throw error;
    }
  }

  rollback() {
    if (this.status !== 'open') throw new Error('SFW1114: Only an uncommitted transaction may be rolled back');
    this.operations.length = 0;
    this.status = 'rolled-back';
  }
}
