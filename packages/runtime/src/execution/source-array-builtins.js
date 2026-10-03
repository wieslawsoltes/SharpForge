import {ManagedFault, isReference} from '../heap.js';
import {boxValue} from './value-types.js';
import {arrayShape} from './arrays.js';
import {arrayCall} from './array-calls.js';
import {indexOfArray} from './array-runtime.js';

/** Source arguments carry static types so generic Resize can instantiate T. */
export function sourceArrayBuiltin(vm, entry, args, types) {
  const profile = entry.arrayRuntime;
  const element = profile.name === 'Resize' ? types[0].replace(/\[\]&$/, '') : null;
  const substitute = type => element ? type.replaceAll('!!0', element) : type;
  const descriptor = {
    kind: 'method', owner: profile.owner, name: profile.name,
    signature: {...profile, parameters: profile.parameters.map(substitute)},
    ...(element ? {methodArguments: [element], genericArguments: [element]} : {})
  };
  if (profile.name === 'IndexOf') {
    if (args[0] === null) throw new ManagedFault('ArgumentNullException', 'Array argument is null');
    const record = vm.heap.get(args[0]);
    const element = record.methodTable.elementType;
    const actual = types[1] && types[1] !== 'null' ? vm.heap.methodTables.get(types[1]) : null;
    if (element.flags.valueType && actual !== element) return arrayShape(record).lowerBounds[0] - 1;
    const value = !element.flags.valueType && actual?.flags.valueType && !isReference(args[1])
      ? boxValue(vm, args[1], actual) : args[1];
    return indexOfArray(vm, args[0], value, args[2] ?? null, args[3] ?? null);
  }
  const result = arrayCall(vm, descriptor, args);
  return result.value;
}
