import {isReference} from './managed-fault.js';
import {snapshotOwnedTable} from './snapshot-address-validation.js';
import {snapshotInteger as integer, invalidSnapshot as fail} from './snapshot-validation-helpers.js';

const i4 = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;

function aggregate(value, type) {
  return Object.isFrozen(value) && value?.valueType === type && Array.isArray(value.fields) &&
    Object.isFrozen(value.fields) && value.fields.length === type.fields.length;
}

function validateNode(context, state, node, last, waiting) {
  if (!node || !['start', 'fields', 'string', 'waiting'].includes(node.phase) ||
      typeof node.defaultOnly !== 'boolean' || !integer(node.index) || !i4(node.hash) ||
      (!last && node.phase !== 'fields') || (node.phase === 'waiting') !== (last && waiting)) fail('Object field continuation');
  const type = node.type === null ? null : snapshotOwnedTable(context, node.type);
  if (type?.containsGenericParameters) fail('Object field continuation open type');
  if (node.phase === 'fields' && (!type?.flags.valueType || !aggregate(node.left, type) ||
      state.operation === 'Equals' && !aggregate(node.right, type) || node.index > node.left.fields.length)) {
    fail('Object field continuation value or bounds');
  }
  if (node.phase === 'string') {
    const left = context.referenceRecord(node.left);
    const right = state.operation === 'Equals' ? context.referenceRecord(node.right) : null;
    if (left.kind !== 'string' || typeof left.data !== 'string' || type !== left.methodTable || node.index > left.data.length ||
        right && (right.kind !== 'string' || typeof right.data !== 'string' || right.data.length !== left.data.length)) {
      fail('Object string continuation storage or bounds');
    }
  }
  if (node.phase === 'waiting') {
    if (!type || !isReference(node.receiver)) fail('Object continuation receiver');
    const receiver = context.referenceRecord(node.receiver);
    if (receiver.methodTable !== type || type.flags.valueType && receiver.kind !== 'box') fail('Object continuation receiver type');
    if (state.operation === 'Equals' && node.argument !== null) context.referenceRecord(node.argument);
  }
}

/** Structural work resolves every retained operand against captured storage, never the current heap. */
export function validateSnapshotObjectValueWork(context) {
  const {vm, snapshot, frames} = context, containers = new Map(), seen = new Set(), captures = new Map();
  for (const group of [snapshot.frames, ...(snapshot.scheduler?.contexts ?? []).map(([, saved]) => saved.frames)]) {
    for (let index = 0; index < group.length; index++) containers.set(group[index].id, {group, index});
  }
  for (const frame of frames.values()) {
    if (Object.hasOwn(frame, 'objectValueResult') && !i4(frame.objectValueResult)) fail('Object continuation result');
    for (const key of ['objectValueWork', 'objectValueContinuation']) {
      const state = frame[key];
      if (state === undefined) continue;
      const waiting = key === 'objectValueContinuation', owner = frames.get(state?.ownerFrameId);
      if (!state || state.owner !== vm.snapshotOwner || !owner || seen.has(state) ||
          !['Equals', 'GetHashCode'].includes(state.operation) || typeof state.capture !== 'boolean' ||
          !integer(state.remaining) || state.remaining > 262144 || state.result !== null && !i4(state.result) ||
          !Array.isArray(state.nodes) || !state.nodes.length || state.nodes.length > 128) fail('Object value continuation');
      seen.add(state);
      if (state.capture) {
        const existing = captures.get(owner.id) ?? [];
        existing.push(state);captures.set(owner.id, existing);
      }
      const location = containers.get(frame.id), caller = containers.get(owner.id);
      if (!waiting && owner !== frame || waiting && (owner === frame || !caller || !location ||
          caller.group !== location.group || caller.index >= location.index)) fail('Object continuation frame ownership');
      state.nodes.forEach((node, index) => validateNode(context, state, node, index === state.nodes.length - 1, waiting));
    }
  }
  for (const frame of frames.values()) {
    const work = frame.intrinsicContinuation;
    if (work?.operation !== 'IndexOf') continue;
    const states = captures.get(frame.id) ?? [], ready = Object.hasOwn(frame, 'objectValueResult');
    if (!work.comparisonPending) {
      if (states.length || ready) fail('array search has an unexpected comparison');
      continue;
    }
    if (work.index >= work.length || states.length + Number(ready) !== 1 ||
        states.some(state => state.operation !== 'Equals') || ready && ![0, 1].includes(frame.objectValueResult)) {
      fail('array search comparison linkage');
    }
  }
}
