import {storageRead, storageWrite, rawArrayBytes} from './array-storage.js';
import {copyArrayElement, arrayValuesEqual} from './array-element-copy.js';
import {storageValue} from './storage.js';
import {ManagedFault} from '../heap.js';
import {SUSPENDED} from '../suspension.js';
import {beginObjectEquals} from './object-value-operation.js';
import {scalarStorageGuard} from './scalar-storage-plan.js';
import {frameById} from './frame-lifetimes.js';

function write(vm, state, record, index, value) {
  const data = record.data;
  const observed = !!vm.onWrite;
  const oldValue = observed ? storageRead(data, index, record.methodTable.elementType, {source: !vm.inspector}) : null;
  storageWrite(data, index, value);
  if (observed) {
    const event = {kind: 'array', handle: state.destination.h, generation: state.destination.g,
      index, value, oldValue, frameId: state.frameId};
    if (vm.notifyWrite) vm.notifyWrite(event);
    else vm.onWrite(event);
  }
}

export function copyArrayStep(vm, state, records) {
  if (state.index >= state.length) return true;
  const index = state.backwards ? state.length - state.index - 1 : state.index;
  const sourceType = records.source.methodTable.elementType;
  const targetType = records.destination.methodTable.elementType;
  if (state.copyKind === 'same' && ArrayBuffer.isView(records.source.data) && !vm.onWrite) {
    records.destination.data[state.destinationIndex + index] = records.source.data[state.sourceIndex + index];
    state.index++;
    return state.index === state.length;
  }
  const loaded = storageRead(records.source.data, state.sourceIndex + index, sourceType, {source: !vm.inspector});
  const value = copyArrayElement(vm, loaded, sourceType, targetType, state.copyKind);
  write(vm, state, records.destination, state.destinationIndex + index, value);
  state.index++;
  return state.index === state.length;
}

export function fillArrayStep(vm, state, records) {
  if (state.index >= state.length) return true;
  const element = records.destination.methodTable.elementType;
  const value = storageValue(vm, state.value, element);
  write(vm, state, records.destination, state.destinationIndex + state.index, value);
  state.index++;
  return state.index === state.length;
}

export function initializeArrayStep(vm, state, records) {
  if (state.index >= state.length) return true;
  const count = Math.min(64, state.length - state.index);
  const bytes = rawArrayBytes(records.destination.data);
  const offset = state.initializerOffset + state.index;
  bytes.set(vm.inspector.pe.bytes.subarray(offset, offset + count), state.index);
  state.index += count;
  return state.index === state.length;
}

export function indexOfArrayStep(vm, state, records) {
  if (state.index >= state.length) return true;
  const index = state.sourceIndex + (state.backwards ? state.length - state.index - 1 : state.index);
  const element = records.source.methodTable.elementType;
  let equal;
  if (state.comparisonPending) {
    const caller = frameById(vm, state.frameId);
    equal = caller.objectValueResult;
    if (equal !== 0 && equal !== 1) {
      throw new ManagedFault('InvalidProgramException', 'Array equality resumed without its managed result');
    }
    delete caller.objectValueResult;
    state.comparisonPending = false;
  } else {
    const data = records.source.data;
    const value = data instanceof Float32Array || data instanceof Float64Array
      ? data[index] : storageRead(data, index, element, {source: !vm.inspector});
    if (scalarStorageGuard(element.enumUnderlyingType?.name ?? element.name)) equal = arrayValuesEqual(vm, value, state.value);
    else {
      state.comparisonPending = true;
      equal = beginObjectEquals(vm, value, state.value, {capture: true, type: element, synchronous: state.frameId === 0});
      if (equal === SUSPENDED) return SUSPENDED;
      state.comparisonPending = false;
    }
  }
  if (equal) {
    state.result = index + state.lowerBound;
    return true;
  }
  state.index++;
  return state.index === state.length;
}
