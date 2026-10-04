import {ManagedFault, isReference} from '../heap.js';
import {SUSPENDED} from '../suspension.js';
import {boxValue} from './boxing.js';
import {isValueRecord, requireValueStorage} from './value-types.js';
import {scalarStorageGuard} from './scalar-storage-plan.js';
import {objectOverride} from './object-dispatch.js';
import {callObjectOverride} from './object-method-call.js';
import {scalarValueEquals, scalarValueHash, stringHash, objectIdentityEquals, objectIdentityHash,
  objectValueRecord} from './object-scalar-values.js';
import {objectValueLimits, objectValueNode, validateObjectValueState} from './object-value-state.js';

const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };

function scalarGuard(vm, type, guard, value) {
  if (!guard || guard(value, vm.options)) return true;
  if (vm.inspector) return false;
  return type?.name === 'System.Boolean' && typeof value === 'boolean' ||
    type?.name === 'System.Double' && typeof value === 'number' ||
    type?.name === 'System.Single' && typeof value === 'number' && Object.is(Math.fround(value), value);
}

function completeNode(state, value) {
  state.nodes.pop();
  if (state.operation === 'Equals' && !value) state.nodes.length = 0;
  const parent = state.nodes.at(-1);
  if (parent && state.operation === 'GetHashCode') parent.hash = Math.imul(parent.hash, 31) ^ value;
  if (!parent) state.result = value;
}

function enterOverride(vm, state, node, target, reference = null) {
  if (state.ownerFrameId === 0) {
    throw new ManagedFault('NotSupportedException', 'Managed Object overrides require cooperative execution');
  }
  const table = node.type;
  if (table.flags.valueType) {
    node.receiver = reference ?? boxValue(vm, node.left, table);
    if (state.operation === 'Equals') {
      node.argument = node.right === null || isReference(node.right) ? node.right : boxValue(vm, node.right, table);
    }
  } else {
    node.receiver = reference;
    node.argument = node.right;
  }
  const receiver = table.flags.valueType ? vm.address('box', 0, node.receiver) : node.receiver;
  const args = state.operation === 'Equals' ? [receiver, node.argument] : [receiver];
  node.phase = 'waiting';
  return callObjectOverride(vm, target, table, node.receiver, args, {objectValueContinuation: state});
}

function referenceValue(vm, state, node) {
  const reference = node.left, record = objectValueRecord(vm, reference);
  if (state.operation === 'Equals' && node.right !== null) objectValueRecord(vm, node.right);
  node.type = record.methodTable;
  const target = node.defaultOnly ? null : objectOverride(vm, node.type, state.operation);
  if (target !== null) return enterOverride(vm, state, node, target, reference);
  if (record.kind === 'string') {
    const other = state.operation === 'Equals' && node.right !== null ? vm.heap.get(node.right) : null;
    if (state.operation === 'Equals' && (other?.kind !== 'string' || record.data.length !== other.data.length)) completeNode(state, 0);
    else {
      node.phase = 'string';
      node.hash = -2128831035;
    }
  } else if (record.kind === 'box') {
    const other = state.operation === 'Equals' && node.right !== null ? vm.heap.get(node.right) : null;
    if (state.operation === 'Equals' && (other?.kind !== 'box' || other.methodTable !== node.type)) completeNode(state, 0);
    else {
      node.left = record.data[0];
      node.right = other?.data[0] ?? null;
      node.defaultOnly = true;
    }
  } else completeNode(state, state.operation === 'Equals'
    ? Number(objectIdentityEquals(vm, reference, node.right)) : objectIdentityHash(vm, reference));
  return null;
}

function nullableValue(state, node) {
  const left = node.left, right = node.right;
  if (state.operation === 'Equals' && (right?.nullableType !== left.nullableType || right.hasValue !== left.hasValue)) {
    completeNode(state, 0);
  } else if (!left.hasValue) completeNode(state, state.operation === 'Equals' ? 1 : 0);
  else {
    node.left = left.value;
    node.right = right?.value ?? null;
    node.type = left.nullableType.nullableType;
    node.defaultOnly = false;
  }
}

function beginNode(vm, state, node) {
  if (state.remaining-- <= 0) throw new ManagedFault('ExecutionLimitException', 'Object value operation exceeded its field budget');
  if (node.left === null) {
    completeNode(state, state.operation === 'Equals' ? Number(node.right === null) : 0);
    return null;
  }
  if (isReference(node.left)) return referenceValue(vm, state, node);
  if (node.left?.nullableType) { nullableValue(state, node); return null; }
  if (!isValueRecord(node.left)) {
    const guard = scalarStorageGuard(node.type?.enumUnderlyingType?.name ?? node.type?.name);
    if (node.type && !node.type.flags.valueType || !scalarGuard(vm, node.type, guard, node.left) ||
        state.operation === 'Equals' && !scalarGuard(vm, node.type, guard, node.right)) invalid('Object field has invalid scalar storage');
    completeNode(state, state.operation === 'Equals'
      ? Number(scalarValueEquals(node.left, node.right)) : scalarValueHash(vm, node.type, node.left));
    return null;
  }
  const type = node.left.valueType;
  if (type.registry !== vm.heap.methodTables || node.type !== null && node.type !== type) invalid('Object value type mismatch');
  node.type = type;
  const target = node.defaultOnly ? null : objectOverride(vm, type, state.operation);
  if (target !== null) return enterOverride(vm, state, node, target);
  if (state.operation === 'Equals' && node.right?.valueType !== type) { completeNode(state, 0); return null; }
  requireValueStorage(vm, type);
  for (const value of state.operation === 'Equals' ? [node.left, node.right] : [node.left]) {
    if (!Object.isFrozen(value) || !Object.isFrozen(value.fields) || value.fields.length !== type.fields.length) {
      invalid('Object field has invalid aggregate storage');
    }
  }
  node.phase = 'fields';
  node.hash = stringHash(type.name);
  return null;
}

function stringStep(vm, state, node) {
  const left = vm.heap.get(node.left).data;
  const right = state.operation === 'Equals' ? vm.heap.get(node.right).data : null;
  const end = Math.min(left.length, node.index + 32);
  for (; node.index < end; node.index++) {
    if (right !== null && left.charCodeAt(node.index) !== right.charCodeAt(node.index)) { completeNode(state, 0); return; }
    if (right === null) node.hash = Math.imul(node.hash ^ left.charCodeAt(node.index), 16777619);
  }
  if (node.index === left.length) completeNode(state, state.operation === 'Equals' ? 1 : node.hash);
}

function nextField(state, node) {
  if (node.index === node.left.fields.length) {
    completeNode(state, state.operation === 'Equals' ? 1 : node.hash);
    return;
  }
  if (state.nodes.length === objectValueLimits.depth) {
    throw new ManagedFault('ExecutionLimitException', 'Object value operation exceeded its nesting limit');
  }
  const index = node.index++;
  state.nodes.push(objectValueNode(node.left.fields[index], node.right?.fields[index] ?? null, node.type.fields[index].type));
}

function runQuantum(vm, state) {
  for (let count = 0; count < objectValueLimits.quantum && state.nodes.length; count++) {
    const node = state.nodes.at(-1);
    if (node.phase === 'fields') nextField(state, node);
    else if (node.phase === 'string') stringStep(vm, state, node);
    else if (beginNode(vm, state, node) === SUSPENDED) return SUSPENDED;
  }
  return state.nodes.length ? SUSPENDED : state.result;
}

function executeWork(vm, owner, state) {
  owner.objectValueWork = state;
  try {
    const result = runQuantum(vm, state);
    if (result !== SUSPENDED || vm.top !== owner) delete owner.objectValueWork;
    return result;
  } catch (error) {
    delete owner.objectValueWork;
    throw error;
  }
}

function begin(vm, operation, left, right, options) {
  const owner = vm.top;
  if (!options.synchronous && (!owner || owner.objectValueWork)) invalid('Object value operation requires an available calling frame');
  const state = {owner: vm.snapshotOwner, ownerFrameId: options.synchronous ? 0 : owner.id, operation, capture: options.capture === true,
    remaining: objectValueLimits.work, result: null,
    nodes: [objectValueNode(left, right, options.type ?? null, options.defaultOnly === true)]};
  if (options.synchronous) return vm.heap.withRoots([left, right], () => {
    let result;
    do { result = runQuantum(vm, state); } while (result === SUSPENDED);
    return result;
  });
  return executeWork(vm, owner, state);
}

/** Return an i4 Boolean or SUSPENDED; capture mode delivers a later result to caller.objectValueResult. */
export function beginObjectEquals(vm, left, right, options = {}) {
  return begin(vm, 'Equals', left, right, options);
}

export function beginObjectHashCode(vm, value, options = {}) {
  return begin(vm, 'GetHashCode', value, null, options);
}

/** A normal managed field call resumes the same bounded operation after its ordinary retirement. */
export function continueObjectValue(vm, frame, value) {
  const state = frame.objectValueContinuation;
  if (!state) return {handled: false, value};
  const owner = validateObjectValueState(vm, state, true);
  if (vm.top !== owner) invalid('Object field return reached a different calling frame');
  if (!vm.inspector && typeof value === 'boolean') value = Number(value);
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) invalid('Object override returned a non-i4 value');
  completeNode(state, state.operation === 'Equals' ? Number(value !== 0) : value);
  const result = state.nodes.length ? executeWork(vm, owner, state) : state.result;
  if (result === SUSPENDED) return {handled: true};
  if (state.capture) { owner.objectValueResult = result; return {handled: true}; }
  return {handled: false, value: !vm.inspector && state.operation === 'Equals' ? !!result : result};
}

/** Resume one charged native quantum before fetching the caller's next instruction. */
export function resumeObjectValueWork(vm, frame) {
  const state = frame.objectValueWork;
  const owner = validateObjectValueState(vm, state);
  if (owner !== frame || vm.top !== frame) invalid('Object work moved to a different calling frame');
  const result = executeWork(vm, frame, state);
  if (result !== SUSPENDED) {
    if (state.capture) frame.objectValueResult = result;
    else (vm.inspector ? frame.stack : vm.stack).push(!vm.inspector && state.operation === 'Equals' ? !!result : result);
  }
}
