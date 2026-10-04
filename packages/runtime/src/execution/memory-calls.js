import {memoryMethodDefinition} from '@sharpforge/cil';
import {singleToInt32Bits, doubleToInt64Bits, int32BitsToSingle, int64BitsToDouble} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {spanCreate, spanFromArray, spanFromString, spanAddress, spanSlice, spanLength, spanToArray} from './spans.js';
import {reinterpretPointer, rawMemoryView} from './raw-memory.js';
import {createArray, arrayAddress, arrayRecord} from './arrays.js';
import {arrayInteger} from './array-limits.js';
import {valueLayout} from './value-layout.js';
import {scalarAccess} from './scalar-bytes.js';
import {number, storage} from './numeric-ops.js';

function readBits(vm, view, table) {
  if (table.name === 'System.Single') return int32BitsToSingle(view.getInt32(0, true));
  if (table.name === 'System.Double') return int64BitsToDouble(view.getBigInt64(0, true));
  const value = view['get' + scalarAccess(table)](0, true);
  return table.name === 'System.Boolean' ? value ? 1 : 0 : storage(value, table.name, vm.options);
}

function bitCall(vm, definition, args) {
  const {operation, descriptor} = definition;
  const type = operation === 'bitBytes' ? descriptor.signature.parameters[0] : descriptor.signature.returnType;
  const table = vm.heap.methodTables.get(type), length = valueLayout(vm, table).size;
  if (operation === 'bitBytes') {
    const array = createArray(vm, 'byte', [length]);
    const view = rawMemoryView(vm, arrayAddress(vm, array, [0]), length, {write: true});
    if (table.name === 'System.Single') view.setInt32(0, singleToInt32Bits(args[0]), true);
    else if (table.name === 'System.Double') view.setBigInt64(0, doubleToInt64Bits(args[0]), true);
    else view['set' + scalarAccess(table)](0, number(args[0]), true);
    return array;
  }
  if (args[0] === null) throw new ManagedFault('ArgumentNullException', 'Byte array cannot be null');
  const record = arrayRecord(vm, args[0]);
  const index = arrayInteger(args[1], 'ArgumentOutOfRangeException');
  if (record.methodTable !== vm.heap.methodTables.get('byte[]')) throw new ManagedFault('ArgumentException', 'Byte vector required');
  if (index < 0 || index >= record.data.length) throw new ManagedFault('ArgumentOutOfRangeException', 'Start index is outside the byte array');
  if (length > record.data.length - index) throw new ManagedFault('ArgumentException', 'Byte array is shorter than the requested scalar');
  return readBits(vm, rawMemoryView(vm, arrayAddress(vm, args[0], [index]), length), table);
}

const spanOperations = Object.freeze({
  spanString: (vm, context) => spanFromString(vm, context.parameters[0]),
  spanCtor: (vm, context) => context.descriptor.signature.parameters[0].includes('*')
    ? spanCreate(vm, context.element, context.parameters[0], context.parameters[1], {readonly: context.readonly})
    : spanFromArray(vm, context.element, context.parameters[0], context.parameters[1] ?? 0,
      context.parameters[2] ?? null, {readonly: context.readonly}),
  spanLength: (vm, context) => spanLength(vm, context.receiver),
  spanEmpty: (vm, context) => spanLength(vm, context.receiver) === 0 ? 1 : 0,
  spanItem: (vm, context) => spanAddress(vm, context.receiver, context.parameters[0]),
  spanPin: (vm, context) => spanLength(vm, context.receiver) ? spanAddress(vm, context.receiver, 0) : null,
  spanSlice: (vm, context) => spanSlice(vm, context.receiver, context.parameters[0], context.parameters[1] ?? null),
  spanArray: (vm, context) => spanToArray(vm, context.receiver),
  spanConvert: (vm, context) => context.parameters[0]?.span
    ? spanCreate(vm, context.element, context.parameters[0].pointer, context.parameters[0].length, {readonly: context.readonly})
    : spanFromArray(vm, context.element, context.parameters[0], 0, null, {readonly: context.readonly}),
  reinterpret: (vm, context) => {
    const types = context.descriptor.methodArguments ?? context.descriptor.genericArguments;
    return reinterpretPointer(vm, context.parameters[0], types[0], types[1]);
  }
});

/** Handle ref-struct calls/newobj without allocating fake object receivers or bypassing profile admission. */
export function memoryCall(vm, descriptor, args, opcode = 'call') {
  const definition = memoryMethodDefinition(descriptor);
  if (!definition) return {handled: false};
  const {operation, element, owner} = definition;
  const constructor = operation === 'spanCtor', directConstructor = constructor && opcode === 'newobj';
  const self = descriptor.signature.isStatic || directConstructor ? null : args[0];
  const parameters = self === null ? args : args.slice(1);
  const receiver = self?.byref && !constructor ? vm.dereference(self) : self;
  const context = {descriptor, element, parameters, receiver, readonly: owner.startsWith('System.ReadOnlySpan')};
  const value = operation.startsWith('bit') ? bitCall(vm, definition, parameters) : spanOperations[operation](vm, context);
  if (constructor && !directConstructor) vm.dereference(self, true, value);
  return {handled: true, returns: directConstructor || descriptor.signature.returnType !== 'void', value};
}
