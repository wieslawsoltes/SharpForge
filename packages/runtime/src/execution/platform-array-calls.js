import {copyArray, clearArray, fillArray, indexOfArray} from './array-runtime.js';

const operations = new Map([
  ['Copy', (vm, args, synchronous) => args.length === 3
    ? copyArray(vm, args[0], args[1], {length: args[2], synchronous})
    : copyArray(vm, args[0], args[2], {sourceIndex: args[1], destinationIndex: args[3], length: args[4], synchronous})],
  ['Clear', (vm, args, synchronous) => clearArray(vm, args[0], {start: args[1], length: args[2], synchronous})],
  ['Fill', (vm, args, synchronous) => fillArray(vm, args[0], args[1], {start: args[2], length: args[3], synchronous})],
  ['IndexOf', (vm, args, synchronous) => indexOfArray(vm, args[0], args[1], {synchronous})],
  ['LastIndexOf', (vm, args, synchronous) => indexOfArray(vm, args[0], args[1], {synchronous, backwards: true})]
]);

/** The released BCL contracts share execution adapters; their IDs and fallback comparer behavior are unchanged. */
export function invokePlatformArray(platform, descriptor, args) {
  const implementation = descriptor.owner === 'System.Array' && operations.get(descriptor.name);
  if (!implementation) return {handled: false};
  return {handled: true, value: implementation(platform.vm, args, platform.vm.state !== 'running')};
}
