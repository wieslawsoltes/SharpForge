import {ManagedFault} from './fault.js';
import {gcInteger, gcBoolean} from './api-arguments.js';
import {validateElementReference} from './byref-array.js';

/** Shared allocation for native MethodSpecs and the explicitly named internal source adapter. */
export function invokeGCArray(platform, descriptor, args) {
  const name = descriptor.gcArrayMethod ?? descriptor.name;
  if (!Object.hasOwn(operations, name)) throw new ManagedFault('InvalidProgramException', 'Unknown GC array operation');
  const operation = operations[name];
  return {handled: true, value: operation(platform, descriptor, args)};
}

function allocateArray(platform, descriptor, args) {
  const length = gcInteger(platform.native(args[0]), 'length');
  const pinned = gcBoolean(platform.native(args[1]), 'pinned');
  const element = descriptor.gcArrayElement ?? platform.native(args[2]);
  if (typeof element !== 'string' || !element || element.length > 1024 ||
      /[!&*]|\b(?:void|System\.Void|pinned|modreq|modopt)\b/.test(element)) {
    throw new ManagedFault('ArgumentException', 'GC array element must be a concrete managed type');
  }
  const table = platform.heap.methodTables.get(element);
  if (table.flags.valueType && !table.flags.primitive && !table.flags.enum) {
    throw new ManagedFault('PlatformNotSupportedException', 'GC array allocation requires a primitive, enum or reference element');
  }
  // Zero initialization is valid for AllocateUninitializedArray; the POH flag controls placement independently.
  const value = platform.heap.array(element, length, {pinned,
    uninitialized: descriptor.gcArrayMethod === 'AllocateUninitializedArray'});
  return value;
}

const operations = Object.freeze({
  AllocateArray: allocateArray,
  AllocateUninitializedArray: allocateArray,
  ValidateElementReference: (platform, descriptor, args) => validateElementReference(platform, args)
});
