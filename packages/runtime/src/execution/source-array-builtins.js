import {ManagedFault} from '../heap.js';
import {unboxValue} from './boxing.js';
import {arrayCall} from './array-calls.js';
import {indexOfArray} from './array-runtime.js';
import {sourceStore, sourceInputTypes} from './source-storage.js';
import {runtimeTypeObject} from './tokens.js';
import {castReference} from './casting.js';
import {spanFromArray, spanFromString, spanToArray} from './spans.js';
import {pointerOffset} from './raw-memory.js';

function spanTable(vm, value, string = false) {
  const table = vm.heap.methodTables.get(vm.value(value));
  if (!table.flags.refStruct || table.typeArguments.length !== 1 || string &&
      (table.typeArguments[0] !== vm.heap.methodTables.get('char') || !table.name.startsWith('System.ReadOnlySpan'))) {
    throw new ManagedFault('InvalidProgramException', 'A closed compatible Span type is required');
  }
  return table;
}

const internal = Object.freeze({
  typeOf: (vm, args) => runtimeTypeObject(vm, vm.value(args[0])),
  cast: (vm, args) => {
    const table = vm.heap.methodTables.get(vm.value(args[1]));
    if (table.flags.pointer) return args[0] === null ? null : pointerOffset(vm, args[0], 0, table.elementType);
    return table.flags.valueType ? unboxValue(vm, args[0], table) : castReference(vm.heap, args[0], table);
  },
  spanFromArray: (vm, args) => {
    const table = spanTable(vm, args[1]);
    return spanFromArray(vm, table.typeArguments[0], args[0], 0, null, {readonly: table.name.startsWith('System.ReadOnlySpan')});
  },
  spanFromString: (vm, args) => {
    spanTable(vm, args[1], true);
    return spanFromString(vm, args[0]);
  },
  spanToArray: (vm, args) => spanToArray(vm, args[0])
});

/** Source arguments retain static types for boxing, generic Resize and immutable Span bridges. */
export function sourceArrayBuiltin(vm, entry, args, types = null) {
  const profile = entry.arrayRuntime;
  if (profile.internal) {
    const operation = internal[profile.operation];
    if (!operation) throw new ManagedFault('MissingMethodException', 'Unregistered source memory bridge');
    return operation(vm, args);
  }
  types ??= vm.top ? sourceInputTypes(vm).slice(-args.length) : [];
  const element = profile.name === 'Resize' ? types[0].replace(/\[\]&$/, '') : null;
  const substitute = type => element ? type.replaceAll('!!0', element) : type;
  const descriptor = {kind: 'method', owner: profile.owner, name: profile.name,
    signature: {...profile, parameters: profile.parameters.map(substitute)},
    ...(element ? {methodArguments: [element], genericArguments: [element]} : {})};
  if (profile.name === 'IndexOf') {
    const value = sourceStore(vm, args[1], 'object', types[1]);
    return vm.heap.withRoots([value], () => indexOfArray(vm, args[0], value,
      {start: args[2], length: args[3], boxed: true, synchronous: vm.state !== 'running'}));
  }
  if (profile.name === 'SetValue') args = [args[0], sourceStore(vm, args[1], 'object', types[1]), ...args.slice(2)];
  return arrayCall(vm, descriptor, args).value;
}
