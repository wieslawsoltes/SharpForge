import {arrayMethodDefinition} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {arrayRuntimeCall} from './array-runtime.js';
import {typeHandle} from './tokens.js';
import {castCacheFor} from './casting.js';
import {arrayRecord, arrayShape, createArray, arrayGet, arraySet, arrayAddress, arrayDimension} from './arrays.js';
import {finishMemoryAccess} from './statics.js';

function vector(vm, reference, type) {
  if (reference === null) throw new ManagedFault('ArgumentNullException', 'Array dimension or index vector is null');
  const record = arrayRecord(vm, reference);
  if (!record.methodTable.flags.szArray || record.methodTable !== vm.heap.methodTables.get(type)) {
    throw new ManagedFault('ArgumentException', 'A matching zero-based integer vector is required');
  }
  if (record.data.length > 32) throw new ManagedFault('ArgumentException', 'Array index or dimension rank exceeds 32');
  return [...record.data];
}

function construct(vm, definition, args, opcode) {
  if (opcode !== 'newobj') throw new ManagedFault('InvalidProgramException', 'Array constructor requires newobj');
  const lower = args.length === definition.rank * 2 ? args.filter((_value, index) => index % 2 === 0) : null;
  const lengths = lower ? args.filter((_value, index) => index % 2 === 1) : args;
  return createArray(vm, definition.elementType, lengths, lower);
}

function reflectCreate(vm, descriptor, args) {
  if (args[0] === null) throw new ManagedFault('ArgumentNullException', 'Array element Type is null');
  const table = typeHandle(vm, args[0]).table, parameters = descriptor.signature.parameters;
  const lengths = parameters[1].endsWith('[]') ? vector(vm, args[1], parameters[1]) : args.slice(1);
  const bounds = parameters.length === 3 && parameters[2].endsWith('[]') ? vector(vm, args[2], parameters[2]) : null;
  return createArray(vm, table, lengths, bounds, {reflection: true});
}

function reflectedElement(vm, context) {
  const {operation, descriptor, args, receiver} = context;
  const parameters = descriptor.signature.parameters, first = operation === 'setValue' ? 2 : 1;
  const indices = parameters.at(-1).endsWith('[]') ? vector(vm, args[first], parameters.at(-1)) : args.slice(first);
  return operation === 'getValue' ? arrayGet(vm, receiver, indices, {reflection: true})
    : arraySet(vm, receiver, indices, args[1], {reflection: true});
}

const operations = Object.freeze({
  get: (vm, context) => arrayGet(vm, context.receiver, context.args.slice(1), {type: context.owner.elementType}),
  set: (vm, context) => arraySet(vm, context.receiver, context.args.slice(1, -1), context.args.at(-1)),
  address: (vm, context) => {
    try {
      return arrayAddress(vm, context.receiver, context.args.slice(1),
        {type: context.owner.elementType, readonly: !!vm.top?.readonlyAccess});
    } finally { if (vm.top) finishMemoryAccess(vm.top); }
  },
  rank: (_vm, context) => context.shape.rank,
  length: (_vm, context) => {
    if (context.record.data.length > 2147483647) throw new ManagedFault('OverflowException', 'Array length exceeds Int32');
    return context.record.data.length;
  },
  longLength: (_vm, context) => BigInt(context.record.data.length),
  GetLength: (vm, context) => arrayDimension(vm, context.receiver, context.args[1]),
  GetLongLength: (vm, context) => BigInt(arrayDimension(vm, context.receiver, context.args[1])),
  GetLowerBound: (vm, context) => arrayDimension(vm, context.receiver, context.args[1], 'lower'),
  GetUpperBound: (vm, context) => arrayDimension(vm, context.receiver, context.args[1], 'upper'),
  getValue: reflectedElement,
  setValue: reflectedElement
});

/** Shared direct-call/newobj hook; args includes the receiver for instance calls. */
export function arrayCall(vm, descriptor, args, opcode = 'call') {
  const runtime = arrayRuntimeCall(vm, descriptor, args);
  if (runtime.handled) return runtime;
  const definition = arrayMethodDefinition(descriptor);
  if (!definition) return {handled: false};
  const {operation, rank} = definition;
  if (operation === 'construct') return {handled: true, returns: true, value: construct(vm, definition, args, opcode)};
  if (operation === 'create') return {handled: true, returns: true, value: reflectCreate(vm, descriptor, args)};
  const receiver = args[0], record = arrayRecord(vm, receiver), shape = arrayShape(record);
  const owner = rank ? vm.heap.methodTables.get(descriptor.owner) : null;
  if (rank && (shape.rank !== rank || !castCacheFor(vm.heap.methodTables).isAssignableFrom(owner, record.methodTable))) {
    throw new ManagedFault('InvalidProgramException', 'Array method receiver has an incompatible array type');
  }
  const value = operations[operation](vm, {operation, descriptor, args, receiver, record, shape, owner});
  return {handled: true, returns: operation !== 'set' && operation !== 'setValue', value};
}
