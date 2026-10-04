import {arrayCall} from './array-calls.js';
import {memoryCall} from './memory-calls.js';

/** Registered call/newobj contribution for array intrinsics and ref-struct memory APIs. */
export function invokeMemoryRuntime(vm, descriptor, args, opcode) {
  const array = arrayCall(vm, descriptor, args, opcode);
  return array.handled ? array : memoryCall(vm, descriptor, args, opcode);
}
