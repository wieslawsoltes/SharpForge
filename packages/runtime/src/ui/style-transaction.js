import {ManagedFault} from '../heap.js';

const identity = reference => `${reference.h}:${reference.g}`;

/** Save only touched UI records and stores; unrelated managed heap contents are never copied. */
export class UIStyleJournal {
  constructor(platform) {
    this.platform = platform;
    this.records = new Map();
    this.stores = new Map();
    this.contexts = new Set();
    this.models = new Map();
  }

  captureReference(reference) {
    const id = identity(reference);
    if (this.records.has(id)) return;
    if (this.records.size >= this.platform.maxCommands) throw new ManagedFault('ExecutionLimitException', 'UI transaction record budget exceeded');
    const record = this.platform.heap.get(reference);
    this.records.set(id, {reference, data: [...record.data]});
  }

  captureStore(store) {
    if (this.stores.has(store)) return;
    this.stores.set(store, {snapshot: store.snapshot(), roots: [...store.retainedValues()]});
  }

  captureModel(model) {
    if (!model?.snapshot || !model?.restore || this.models.has(model)) return;
    const retained = typeof model.retainedValues === 'function' ? [...model.retainedValues()] : [...(model.retainedValues ?? [])];
    this.models.set(model, {snapshot: model.snapshot(), retained});
  }

  *roots() {
    for (const {reference, data} of this.records.values()) { yield reference; yield* data; }
    for (const {roots} of this.stores.values()) yield* roots;
    for (const {retained} of this.models.values()) yield* retained;
  }

  rollback() {
    const platform = this.platform;
    platform.heap.withRoots([...this.roots()], () => {
      for (const {reference, data} of this.records.values()) platform.heap.replaceData(reference, data);
      for (const [store, data] of this.stores) store.restore(data.snapshot, {
        resolveParent: reference => reference ? platform.ui.properties.storeFor(reference) : null
      });
      for (const id of this.contexts) {
        if (id < 0) platform.ui.work.pending.delete(id);
        else platform.vm.scheduler.contexts.delete(id);
      }
      for (const [model, data] of this.models) model.restore(data.snapshot);
    });
  }
}

/** Commit host commands after a successful style scope; failed scopes expose no partial property writes. */
export function withStyleTransaction(platform, action) {
  if (platform.styleDepth) return action();
  const journal = new UIStyleJournal(platform);
  const previous = platform.transaction;
  const offset = previous?.length ?? 0;
  const transaction = previous ?? platform.beginTransaction();
  const pendingWrite = platform.vm.pendingWrite;
  platform.ui.journal = journal;
  platform.styleDepth++;
  let result;
  try {
    result = action();
  } catch (error) {
    platform.ui.journal = null;
    journal.rollback();
    platform.vm.pendingWrite = pendingWrite;
    if (previous) previous.length = offset;
    else platform.rollbackTransaction(transaction);
    throw error;
  } finally {
    platform.ui.journal = null;
    platform.styleDepth--;
  }
  if (!previous) platform.commitTransaction(transaction);
  return result;
}
