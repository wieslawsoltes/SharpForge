import {SyncPrimitives} from './sync-primitives.js';
import {validateSynchronizationSnapshot} from './sync-snapshot-validation.js';
import {snapshotAddress, sameSnapshotReference} from './snapshot-address-validation.js';
import {invalidSnapshot as fail} from './snapshot-validation-helpers.js';

/** Synchronization queues, task waiters and writable flags belong to one captured graph. */
export function validateSnapshotSynchronization(context) {
  const {vm, snapshot} = context, state = snapshot.sync;
  if (state === undefined) return;
  validateSynchronizationSnapshot(vm, state, snapshot);
  if (state.blocks.length && !snapshot.scheduler) fail('synchronization contexts');
  const contexts = new Map(snapshot.scheduler?.contexts ?? []);
  const tasks = new Map((snapshot.scheduler?.tasks ?? []).map(([, task]) => [task.ref.h + ':' + task.ref.g, task]));
  const queued = new Set();
  for (const [, block] of state.blocks) for (const item of [...block.entries, ...block.conditions]) {
    const saved = contexts.get(item.contextId), task = tasks.get(item.task.h + ':' + item.task.g);
    if (!saved || saved.status !== 'waiting' || !task || task.status !== 'waiting' ||
        !task.waiters.includes(item.contextId) || !saved.wait || !sameSnapshotReference(saved.wait.task, item.task) ||
        queued.has(item.contextId)) fail('synchronization wait');
    queued.add(item.contextId);
    if (item.flag !== null) {
      const address = snapshotAddress(context, item.flag);
      if (address.readonly || address.onePast || address.type.name !== 'System.Boolean') fail('monitor flag address');
    }
  }
}

/** Allocate a missing lazy component and its detached block map before any state is committed. */
export function prepareSynchronizationRestore(vm, values) {
  const saved = values.get('sync');
  if (!saved && !vm.sync) return null;
  return {instance: vm.sync ?? new SyncPrimitives(vm), included: saved !== undefined,
    blocks: new Map(saved?.blocks ?? []), fenceRevision: saved?.fenceRevision ?? 0, contentions: saved?.contentions ?? 0n};
}

export function restoreSnapshotSynchronization(vm, prepared) {
  if (!prepared) return;
  const {instance, blocks, fenceRevision, contentions} = prepared;
  Object.assign(instance, {blocks, fenceRevision, contentions});
  if (prepared.included) vm.sync = instance;
  else delete vm.sync;
}
