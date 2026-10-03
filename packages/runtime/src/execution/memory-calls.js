import {memoryMethodDefinition} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {spanCreate, spanFromArray, spanAddress, spanSlice, spanLength, spanToArray} from './spans.js';
import {nullableValue, valueDefault} from './value-types.js';
import {reinterpretPointer, rawMemoryView} from './raw-memory.js';
import {createArray, arrayAddress} from './arrays.js';
import {valueLayout} from './value-layout.js';
import {number, storage} from './numeric-ops.js';

const bitMethods = new Map([
  ['bool', 'Uint8'], ['byte', 'Uint8'], ['char', 'Uint16'], ['short', 'Int16'], ['ushort', 'Uint16'],
  ['int', 'Int32'], ['uint', 'Uint32'], ['long', 'BigInt64'], ['ulong', 'BigUint64'],
  ['float', 'Float32'], ['double', 'Float64']
]);

function bitMethod(type) {
  const short = new Map([
    ['System.Boolean', 'bool'], ['System.Byte', 'byte'], ['System.Char', 'char'], ['System.Int16', 'short'],
    ['System.UInt16', 'ushort'], ['System.Int32', 'int'], ['System.UInt32', 'uint'],
    ['System.Int64', 'long'], ['System.UInt64', 'ulong'], ['System.Single', 'float'], ['System.Double', 'double']
  ]).get(type) ?? type;
  const method = bitMethods.get(short);
  if (!method) throw new ManagedFault('MissingMethodException', 'Unsupported BitConverter scalar');
  return method;
}

function bitCall(vm, definition, args) {
  const {operation, descriptor} = definition;
  const from = descriptor.signature.parameters[0];
  const to = descriptor.signature.returnType;
  if (operation === 'bitScalar') {
    const view = new DataView(new ArrayBuffer(8));
    view['set' + bitMethod(from)](0, number(args[0]), true);
    return storage(view['get' + bitMethod(to)](0, true), to, vm.options);
  }
  if (operation === 'bitBytes') {
    const length = valueLayout(vm, from).size;
    const array = createArray(vm, 'byte', [length]);
    const view = rawMemoryView(vm, arrayAddress(vm, array, [0]), length, {write: true});
    view['set' + bitMethod(from)](0, number(args[0]), true);
    return array;
  }
  const pointer = arrayAddress(vm, args[0], [number(args[1])], {type: 'byte'});
  const view = rawMemoryView(vm, pointer, valueLayout(vm, to).size);
  return storage(view['get' + bitMethod(to)](0, true), to, vm.options);
}

/** Handles call and newobj without constructing a fake managed object for ref structs. */
export function memoryCall(vm, descriptor, args, opcode = 'call') {
  const definition = memoryMethodDefinition(descriptor);
  if (!definition) return {handled: false};
  const {operation, element, owner} = definition;
  const constructor = operation.endsWith('Ctor');
  const directConstructor = constructor && opcode === 'newobj';
  const self = descriptor.signature.isStatic || directConstructor ? null : args[0];
  const parameters = self === null ? args : args.slice(1);
  const receiver = self?.byref && !constructor ? vm.dereference(self) : self;
  const readonly = owner.startsWith('System.ReadOnlySpan');
  let value;
  if (operation.startsWith('bit')) value = bitCall(vm, definition, parameters);
  else switch (operation) {
    case 'spanCtor':
      value = descriptor.signature.parameters[0].includes('*')
        ? spanCreate(vm, element, parameters[0], parameters[1], {readonly})
        : spanFromArray(vm, element, parameters[0], parameters[1] ?? 0, parameters[2] ?? null, {readonly});
      break;
    case 'spanLength': value = spanLength(vm, receiver); break;
    case 'spanEmpty': value = spanLength(vm, receiver) === 0 ? 1 : 0; break;
    case 'spanItem': value = spanAddress(vm, receiver, parameters[0]); break;
    case 'spanPin': value = spanLength(vm, receiver) ? spanAddress(vm, receiver, 0) : null; break;
    case 'spanSlice': value = spanSlice(vm, receiver, parameters[0], parameters[1] ?? null); break;
    case 'spanArray': value = spanToArray(vm, receiver); break;
    case 'spanConvert':
      value = parameters[0]?.span
        ? spanCreate(vm, element, parameters[0].pointer, parameters[0].length, {readonly})
        : spanFromArray(vm, element, parameters[0], 0, null, {readonly});
      break;
    case 'nullableCtor': value = nullableValue(vm, owner, parameters[0], true); break;
    case 'nullableHasValue': value = receiver.hasValue ? 1 : 0; break;
    case 'nullableValue':
      if (!receiver.hasValue) throw new ManagedFault('InvalidOperationException', 'Nullable object must have a value');
      value = receiver.value;
      break;
    case 'nullableDefault': value = receiver.hasValue ? receiver.value : parameters[0] ?? valueDefault(vm, element); break;
    case 'reinterpret': {
      const types = descriptor.methodArguments ?? descriptor.genericArguments;
      value = reinterpretPointer(vm, parameters[0], types[0], types[1]);
      break;
    }
  }
  if (constructor && !directConstructor) vm.dereference(self, true, value);
  return {handled: true, returns: directConstructor || descriptor.signature.returnType !== 'void', value};
}
