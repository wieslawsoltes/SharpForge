import {ManagedFault, isReference} from '../heap.js';
import {SUSPENDED} from '../suspension.js';
import {arrayCopyKind} from './array-element-copy.js';
import {fieldInitializer} from './array-initializers.js';
import {rawArrayBytes} from './array-storage.js';
import {sortArrayStep, reverseArrayStep} from './array-sort-work.js';
import {copyArrayStep, fillArrayStep, initializeArrayStep, indexOfArrayStep} from './array-transfer-work.js';

/** A charged unit performs at most 32 bounded element operations (or 2048 initializer bytes). */
export const arrayWorkQuantum = 32;
const operations = new Map([
  ['Sort', sortArrayStep], ['Reverse', reverseArrayStep], ['Copy', copyArrayStep],
  ['Clear', fillArrayStep], ['Fill', fillArrayStep], ['InitializeArray', initializeArrayStep], ['IndexOf', indexOfArrayStep]
]);
const owner = vm => vm.snapshotOwner ?? vm.heap.handleOwner;
const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };
const integer = Number.isSafeInteger;
const clock = () => performance.now();

function recordFor(vm, reference) {
  if (!isReference(reference)) invalid('Array continuation requires a managed reference');
  const record = vm.heap.get(reference);
  if (record.kind !== 'array') invalid('Array continuation requires array storage');
  return record;
}

function checkedRange(record, offset, length) {
  if (!integer(offset) || offset < 0 || offset > record.data.length - length) invalid('Array continuation exceeds its storage');
}

function validateSort(state, record) {
  if (record.data.length !== state.length || state.length < 2 || !['build', 'extract'].includes(state.phase) ||
      typeof state.sifting !== 'boolean' || !integer(state.root) || state.root < 0 || state.root >= state.length ||
      !integer(state.end) || state.end < 0 || state.end >= state.length ||
      !integer(state.buildIndex) || state.buildIndex < -1 || state.buildIndex >= Math.floor(state.length / 2)) {
    invalid('Array sort continuation is malformed');
  }
  if (state.operation === 'Reverse' && state.end !== state.length - state.index - 1) invalid('Array reverse indices disagree');
}

/** Validate captured or live state without scanning data, retaining mutable buffers, or invoking managed code. */
export function validateArrayContinuation(vm, frame) {
  const state = frame.intrinsicContinuation;
  if (!state) return null;
  if (state.kind !== 'array' || state.owner !== owner(vm) || state.frameId !== (frame.id ?? 0) ||
      !operations.has(state.operation) || typeof state.pushResult !== 'boolean' ||
      !integer(state.length) || state.length < 0 || !integer(state.index) || state.index < 0 || state.index > state.length ||
      !integer(state.work) || state.work < 0 || !['void', 'destination', 'search'].includes(state.resultKind)) {
    invalid('Malformed or foreign array continuation');
  }
  const source = state.source ? recordFor(vm, state.source) : null;
  const destination = state.destination ? recordFor(vm, state.destination) : null;
  if (state.operation === 'Sort' || state.operation === 'Reverse') {
    if (!destination || source) invalid('Sort continuation has invalid owners');
    validateSort(state, destination);
  } else if (state.operation === 'Copy') {
    if (!source || !destination) invalid('Copy continuation requires two arrays');
    checkedRange(source, state.sourceIndex, state.length);
    checkedRange(destination, state.destinationIndex, state.length);
    const backwards = state.source.h === state.destination.h && state.source.g === state.destination.g &&
      state.destinationIndex > state.sourceIndex;
    if (state.backwards !== backwards || state.copyKind !== arrayCopyKind(vm.heap.methodTables,
      source.methodTable.elementType, destination.methodTable.elementType)) invalid('Copy continuation type or direction changed');
  } else if (state.operation === 'InitializeArray') {
    if (!destination || source) invalid('Initializer continuation has invalid owners');
    const byteLength = destination.data.readonlySnapshotArray
      ? destination.data.byteLength : rawArrayBytes(destination.data).length;
    if (byteLength !== state.length) invalid('Initializer array changed shape');
    const plan = fieldInitializer(vm, state.initializerToken);
    if (plan.offset !== state.initializerOffset || state.length > plan.size) invalid('Initializer data changed');
  } else if (state.operation === 'IndexOf') {
    if (!source || destination || typeof state.backwards !== 'boolean' || !integer(state.lowerBound) || !integer(state.result) ||
        typeof state.comparisonPending !== 'boolean') {
      invalid('Search continuation is malformed');
    }
    checkedRange(source, state.sourceIndex, state.length);
  } else {
    if (!destination || source) invalid('Fill continuation has invalid owners');
    checkedRange(destination, state.destinationIndex, state.length);
  }
  if (state.resultAddress && (state.operation !== 'Copy' || !state.resultAddress.byref ||
      !Object.isFrozen(state.resultAddress) || state.resultAddress.vmOwner !== vm.snapshotOwner)) {
    invalid('Array resize completion address is invalid');
  }
  if (state.resultKind === 'destination' && !destination || state.resultKind === 'search' && state.operation !== 'IndexOf') {
    invalid('Array continuation result is invalid');
  }
  return state;
}

function complete(vm, state) {
  if (state.resultAddress) vm.dereference(state.resultAddress, true, state.destination);
  return state.resultKind === 'destination' ? state.destination : state.resultKind === 'search' ? state.result : null;
}

/** Start cooperative work on the calling frame; direct host helpers may request synchronous completion. */
export function beginArrayOperation(vm, operation, {returns = false, synchronous = false} = {}) {
  const frame = !synchronous && vm.top || {id: 0};
  if (frame.intrinsicContinuation) invalid('A frame already has a pending intrinsic');
  frame.intrinsicContinuation = {kind: 'array', owner: owner(vm), frameId: frame.id ?? 0,
    work: 0, index: 0, resultKind: 'void', ...operation, pushResult: !vm.inspector || returns};
  try { validateArrayContinuation(vm, frame); }
  catch (error) {
    delete frame.intrinsicContinuation;
    throw error;
  }
  if (frame !== vm.top) {
    let result;
    do { result = resumeArrayOperation(vm, frame, {workBudget: 1024}); } while (!result.done);
    return result.value;
  }
  return SUSPENDED;
}

/** Resume bounded work, reacquiring live backing after every yield or restore. */
export function resumeArrayOperation(vm, frame, {deadline = Infinity, workBudget = 1, now = clock} = {}) {
  if (!integer(workBudget) || workBudget < 0 || typeof deadline !== 'number' || Number.isNaN(deadline)) {
    throw new RangeError('Invalid intrinsic work budget');
  }
  const state = validateArrayContinuation(vm, frame);
  if (!state) return {work: 0, done: true, returns: false, value: null};
  const records = {
    source: state.source ? recordFor(vm, state.source) : null,
    destination: state.destination ? vm.heap.ensureWritable(state.destination) : null
  };
  const step = operations.get(state.operation);
  let work = 0, done = false, suspended = false, value = null;
  try {
    while (work < workBudget && now() < deadline) {
      work++;
      state.work++;
      for (let index = 0; index < arrayWorkQuantum; index++) {
        const result = step(vm, state, records);
        if (result === SUSPENDED) { suspended = true; break; }
        if (result) { done = true; break; }
      }
      if (done || suspended) break;
    }
    if (done) {
      value = complete(vm, state);
      delete frame.intrinsicContinuation;
    }
  } catch (error) {
    delete frame.intrinsicContinuation;
    throw error;
  } finally {
    if (work && state.destination) {
      vm.heap.mutationRevision++;
      vm.writeRevision = (vm.writeRevision ?? 0) + 1;
    }
  }
  return {work, done, returns: state.pushResult, value};
}

export function cancelArrayOperation(frame) {
  delete frame.intrinsicContinuation;
}

export function* arrayContinuationRoots(frame) {
  const state = frame.intrinsicContinuation;
  if (state?.kind !== 'array') return;
  for (const field of ['reference', 'source', 'destination', 'value', 'resultAddress']) if (state[field]) yield state[field];
}
