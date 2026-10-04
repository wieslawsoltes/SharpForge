import {
  ManagedFault
} from '../heap.js';
import {
  frameById
} from './frame-lifetimes.js';

const kinds = new Map([
  ['System.RuntimeArgumentHandle', 'runtimeArgumentHandle'],
  ['System.ArgIterator', 'argIterator'],
  ['System.TypedReference', 'typedReference'],
  ['typedref', 'typedReference']
]);

/** Runtime-only argument records cannot be forged or copied into unrelated struct storage. */
export function varargsStorage(vm, value, type) {
  const name = typeof type === 'string' ? type : type?.name;
  const kind = kinds.get(name);
  if (!kind) {
    if (value?.runtimeArgumentHandle || value?.argIterator || value?.typedReference) {
      throw new ManagedFault('InvalidCastException', 'Argument structures require exact declared storage');
    }
    return {
      handled: false
    };
  }
  if (value === null) return {
    handled: true,
    value: null
  };
  if (!value?.[kind] || value.vmOwner !== vm.snapshotOwner || !Object.isFrozen(value) ||
    kind !== 'typedReference' && !frameById(vm, value.frameId)) {
    throw new ManagedFault('InvalidProgramException', 'Argument structure is malformed or outlived its frame');
  }
  if (kind === 'typedReference' && (value.type?.registry !== vm.heap.methodTables ||
      !value.pointer?.byref || value.pointer.vmOwner !== vm.snapshotOwner)) {
    throw new ManagedFault('InvalidProgramException', 'Typed reference belongs to another VM');
  }
  return {
    handled: true,
    value
  };
}

export function isVarargsStorage(type) {
  return kinds.has(typeof type === 'string' ? type : type?.name);
}
