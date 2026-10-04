import {ManagedFault} from '../heap.js';
import {frameById} from './frame-lifetimes.js';

export const objectValueLimits = Object.freeze({work: 262144, depth: 128, quantum: 32});
const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };

export function objectValueNode(left, right, type = null, defaultOnly = false) {
  return {left, right, type, defaultOnly, phase: 'start', index: 0, hash: 0};
}

/** Pending field work stores owned values and counters, never host callbacks or mutable backing arrays. */
export function validateObjectValueState(vm, state, waiting = false) {
  if (!state || state.owner !== vm.snapshotOwner || !['Equals', 'GetHashCode'].includes(state.operation) ||
      typeof state.capture !== 'boolean' || !Number.isSafeInteger(state.remaining) ||
      state.remaining < 0 || state.remaining > objectValueLimits.work || !Array.isArray(state.nodes) ||
      !state.nodes.length || state.nodes.length > objectValueLimits.depth) invalid('Malformed Object value continuation');
  const owner = frameById(vm, state.ownerFrameId);
  for (const node of state.nodes) {
    if (!node || !['start', 'fields', 'string', 'waiting'].includes(node.phase) || typeof node.defaultOnly !== 'boolean' ||
        !Number.isSafeInteger(node.index) || node.index < 0 || !Number.isInteger(node.hash) ||
        node.type !== null && node.type?.registry !== vm.heap.methodTables) invalid('Malformed Object field continuation');
    if (node.phase === 'fields' && (!node.type || !Array.isArray(node.left?.fields) || node.index > node.left.fields.length)) {
      invalid('Object field continuation exceeds its value');
    }
  }
  if ((state.nodes.at(-1).phase === 'waiting') !== waiting) invalid('Object continuation has an invalid call state');
  return owner;
}

/** Every operand, temporary box and pending field argument remains visible to the existing heap value walker. */
export function visitObjectValueRoots(frame, visit) {
  for (const state of [frame.objectValueWork, frame.objectValueContinuation]) {
    for (const node of state?.nodes ?? []) {
      visit(node.left);
      visit(node.right);
      visit(node.receiver);
      visit(node.argument);
    }
  }
}

/** An exceptional exit abandons work; captured array searches cannot resume a call that already threw. */
export function cancelObjectValueWork(frame) {
  delete frame.objectValueWork;
  delete frame.objectValueResult;
  if (frame.intrinsicContinuation?.comparisonPending) delete frame.intrinsicContinuation;
}

/** A caught fault in a managed callback must preserve the callback's outer continuation. */
export function abandonObjectValue(vm, frame) {
  const state = frame.objectValueContinuation;
  cancelObjectValueWork(frame);
  delete frame.objectValueContinuation;
  if (!state?.capture) return;
  const owner = frameById(vm, state.ownerFrameId);
  cancelObjectValueWork(owner);
}
