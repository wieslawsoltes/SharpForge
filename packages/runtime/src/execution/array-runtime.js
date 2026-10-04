import {arrayRuntimeDefinition} from '@sharpforge/cil';
import {ManagedFault, isReference} from '../heap.js';
import {arrayRecord, arrayShape, createArray} from './arrays.js';
import {arrayInteger} from './array-limits.js';
import {unboxValue} from './boxing.js';
import {storageDefault, storageValue} from './storage.js';
import {checkElementStore} from './casting.js';
import {arrayCopyKind} from './array-element-copy.js';
import {arrayInitializer} from './array-initializers.js';
import {beginArrayOperation} from './array-continuations.js';

export function argumentArray(vm, reference) {
  if (reference === null) throw new ManagedFault('ArgumentNullException', 'Array argument is null');
  return arrayRecord(vm, reference);
}

function range(record, start, count) {
  const lower = arrayShape(record).lowerBounds[0];
  const offset = arrayInteger(start, 'ArgumentOutOfRangeException') - lower;
  const length = arrayInteger(count, 'ArgumentOutOfRangeException');
  if (offset < 0 || length < 0 || offset > record.data.length - length) {
    throw new ManagedFault('ArgumentException', 'Array range exceeds its bounds');
  }
  return {offset, length};
}

/** Copy validates both complete ranges before mutation and retains memmove direction across yields. */
export function copyArray(vm, source, destination, options = {}) {
  return vm.heap.withRoots([source, destination, options.resultAddress], () => {
    const from = argumentArray(vm, source), to = argumentArray(vm, destination);
    if (arrayShape(from).rank !== arrayShape(to).rank) throw new ManagedFault('RankException', 'Array ranks differ');
    const length = options.length ?? from.data.length;
    const input = range(from, options.sourceIndex ?? arrayShape(from).lowerBounds[0], length);
    const output = range(to, options.destinationIndex ?? arrayShape(to).lowerBounds[0], length);
    const copyKind = arrayCopyKind(vm.heap.methodTables, from.methodTable.elementType, to.methodTable.elementType);
    if (input.length === 0) {
      if (options.resultAddress) vm.dereference(options.resultAddress, true, destination);
      return options.resultKind === 'destination' ? destination : null;
    }
    return beginArrayOperation(vm, {operation: 'Copy', source, destination, length: input.length,
      sourceIndex: input.offset, destinationIndex: output.offset, copyKind,
      backwards: source.h === destination.h && source.g === destination.g && output.offset > input.offset,
      resultKind: options.resultKind ?? 'void', resultAddress: options.resultAddress ?? null},
    {synchronous: options.synchronous !== false, returns: !!options.returns});
  });
}

export function fillArray(vm, reference, value, options = {}) {
  return vm.heap.withRoots([reference, value], () => {
    const record = argumentArray(vm, reference);
    const bounds = range(record, options.start ?? arrayShape(record).lowerBounds[0], options.length ?? record.data.length);
    const element = record.methodTable.elementType;
    const stored = storageValue(vm, value, element);
    checkElementStore(vm.heap, element, stored);
    if (!bounds.length) return null;
    return beginArrayOperation(vm, {operation: options.operation ?? 'Fill', destination: reference,
      destinationIndex: bounds.offset, length: bounds.length, value: stored}, {synchronous: options.synchronous !== false});
  });
}

export function clearArray(vm, reference, options = {}) {
  const record = argumentArray(vm, reference);
  return fillArray(vm, reference, storageDefault(vm, record.methodTable.elementType), {...options, operation: 'Clear'});
}

export function cloneArray(vm, reference, {synchronous = true} = {}) {
  const record = argumentArray(vm, reference), shape = arrayShape(record);
  return vm.heap.withRoots([reference], () => {
    const clone = createArray(vm, record.methodTable.elementType, [...shape.lengths], [...shape.lowerBounds]);
    return copyArray(vm, reference, clone, {synchronous, resultKind: 'destination', returns: true});
  });
}

export function indexOfArray(vm, reference, value, options = {}) {
  const record = argumentArray(vm, reference), shape = arrayShape(record);
  if (shape.rank !== 1) throw new ManagedFault('RankException', 'IndexOf requires one dimension');
  const lower = shape.lowerBounds[0];
  let start = options.start ?? lower;
  let length = options.length ?? record.data.length - (start - lower);
  if (options.backwards) {
    start = options.start ?? lower + record.data.length - 1;
    length = options.length ?? start - lower + 1;
    start -= length - 1;
  }
  const bounds = range(record, start, length), element = record.methodTable.elementType;
  if (options.boxed && element.flags.valueType) {
    if (value === null || !isReference(value) || vm.heap.get(value).methodTable !== element) return lower - 1;
    value = unboxValue(vm, value, element);
  }
  if (!bounds.length) return lower - 1;
  return vm.heap.withRoots([reference, value], () => beginArrayOperation(vm, {
    operation: 'IndexOf', source: reference, sourceIndex: bounds.offset, length: bounds.length,
    lowerBound: lower, value, backwards: !!options.backwards, comparisonPending: false, resultKind: 'search', result: lower - 1
  }, {synchronous: options.synchronous !== false, returns: true}));
}

export function initializeArray(vm, reference, handle, {synchronous = true} = {}) {
  const record = argumentArray(vm, reference), plan = arrayInitializer(vm, record, handle);
  if (!plan.length) return null;
  return beginArrayOperation(vm, {operation: 'InitializeArray', destination: reference, ...plan}, {synchronous});
}

function resizeArray(vm, definition, args) {
  const previous = vm.dereference(args[0]);
  const length = arrayInteger(args[1], 'ArgumentOutOfRangeException');
  if (length < 0) throw new ManagedFault('ArgumentOutOfRangeException', 'Resize length is negative');
  if (previous !== null && length === arrayRecord(vm, previous).data.length) return null;
  return vm.heap.withRoots([previous, args[0]], () => {
    const replacement = createArray(vm, definition.element, [length]);
    if (previous === null) {
      vm.dereference(args[0], true, replacement);
      return null;
    }
    return copyArray(vm, previous, replacement, {length: Math.min(length, arrayRecord(vm, previous).data.length),
      resultAddress: args[0], synchronous: false});
  });
}

const implementations = Object.freeze({
  initialize: (vm, _definition, args) => initializeArray(vm, args[0], args[1], {synchronous: false}),
  clone: (vm, _definition, args) => {
    arrayRecord(vm, args[0]);
    return cloneArray(vm, args[0], {synchronous: false});
  },
  clear: (vm, _definition, args) => clearArray(vm, args[0], {start: args[1], length: args[2], synchronous: false}),
  copy: (vm, _definition, args) => args.length === 3
    ? copyArray(vm, args[0], args[1], {length: args[2], synchronous: false})
    : copyArray(vm, args[0], args[2], {sourceIndex: args[1], destinationIndex: args[3], length: args[4], synchronous: false}),
  indexOf: (vm, definition, args) => indexOfArray(vm, args[0], args[1], {
    start: args[2], length: args[3], boxed: !definition.element, synchronous: false
  }),
  resize: resizeArray
});

/** Paired CIL profile admission selects a complete runtime operation before any fallback call path. */
export function arrayRuntimeCall(vm, descriptor, args) {
  const definition = arrayRuntimeDefinition(descriptor);
  if (!definition) return {handled: false};
  const implementation = implementations[definition.operation];
  if (!implementation) throw new ManagedFault('MissingMethodException', 'Unregistered array operation');
  const value = implementation(vm, definition, args);
  return {handled: true, returns: descriptor.signature.returnType !== 'void', value};
}
