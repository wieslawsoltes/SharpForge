import {callSignatureKey, parseFunctionPointerType} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {cachedMetadataToken, verifiedMethod} from './token-cache.js';
import {isNativeStorageType} from './native-int.js';

const pointers = new WeakSet();

/** Keep the established immutable carrier shape; only pointers produced by ldftn are callable. */
export function createMethodPointer(vm, token) {
  const pointer = Object.freeze({methodPointer: true, vmOwner: vm.snapshotOwner, token});
  pointers.add(pointer);
  return pointer;
}

export function isMethodPointer(vm, value) {
  return pointers.has(value) && value.vmOwner === vm.snapshotOwner;
}

export function methodPointerSignature(vm, pointer) {
  if (!isMethodPointer(vm, pointer) || !verifiedMethod(vm, pointer.token)) {
    throw new ManagedFault('InvalidProgramException', 'A verified managed function pointer from this VM is required');
  }
  return cachedMetadataToken(vm, pointer.token).signature;
}

/** Preserve opaque pointers only in native-int or exactly matching function-pointer storage. */
export function storeMethodPointer(vm, value, type) {
  const declared = parseFunctionPointerType(type);
  if (declared && value === null) return null;
  const signature = methodPointerSignature(vm, value);
  if (declared ? callSignatureKey(declared) !== callSignatureKey(signature) : !isNativeStorageType(type)) {
    throw new ManagedFault('InvalidProgramException', 'Managed function pointer storage signature mismatch');
  }
  return value;
}
