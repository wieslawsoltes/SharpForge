import {
  isReference
} from '../heap.js';
const key = reference => reference.h + ':' + reference.g;

/** Validate before any snapshot component mutates the live VM. */
export function validateSynchronizationSnapshot(vm, state, snapshot = {}) {
  const invalid = () => {
    throw new TypeError('Invalid snapshot synchronization state');
  };
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const reference = value => isReference(value) && integer(value.h) && integer(value.g) && value.g > 0 && (value.heapOwner === undefined || value
    .heapOwner === vm.heap.handleOwner) && (!snapshot.heap || snapshot.heap.records[value.h] && snapshot.heap.generations[value.h] === value.g);
  if (!state || !Array.isArray(state.blocks) || !integer(state.fenceRevision) || typeof state.contentions !== 'bigint' || state.contentions < 0n)
    invalid();
  const keys = new Set(),
    contexts = snapshot.scheduler ? new Set(snapshot.scheduler.contexts.map(([id]) => id)) : null;
  for (const row of state.blocks) {
    if (!Array.isArray(row) || row.length !== 2) invalid();
    const [id, block] = row;
    if (!block || !reference(block.reference) || id !== key(block.reference) || keys.has(id) || typeof block.abandoned !== 'boolean' || !Array
      .isArray(block.entries) || !Array.isArray(block.conditions) || !integer(block.depth) || block.depth > 2147483647 || (block.owner === null ?
        block.depth !== 0 : !integer(block.owner) || block.owner === 0 || block.depth === 0 || contexts && !contexts.has(block.owner))) invalid();
    keys.add(id);
    const seen = new Set();
    for (const [kind, queue] of [
        ['entry', block.entries],
        ['condition', block.conditions]
      ])
      for (const item of queue) {
        if (!item || !integer(item.contextId) || item.contextId === 0 || contexts && !contexts.has(item.contextId) || seen.has(item.contextId) || !
          reference(item.task) || !['enter', 'wait'].includes(item.kind) || kind === 'condition' && item.kind !== 'wait' || !integer(item.depth) ||
          item.depth === 0 || item.depth > 2147483647 || !['bool', 'void'].includes(item.resultType) || typeof item.result !== 'boolean' || item
          .deadline !== null && (!Number.isFinite(item.deadline) || item.deadline < 0)) invalid();
        if (item.flag !== null && (!item.flag?.byref || item.flag.vmOwner !== vm.snapshotOwner || !Object.isFrozen(item.flag))) invalid();
        seen.add(item.contextId);
      }
  }
  return state;
}
