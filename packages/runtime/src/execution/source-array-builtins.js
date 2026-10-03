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
  if (profile.name === 'IndexOf') return indexOfArray(vm, args[0], args[1], args[2] ?? null, args[3] ?? null);
  const result = arrayCall(vm, descriptor, args);
  return result.value;
}
