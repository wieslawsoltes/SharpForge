import {invokeMemoryRuntime} from './memory-call-adapter.js';
import {invokeFrameworkInterface} from './framework-interface-calls.js';
import {
  invokeAsyncIntrinsic
} from './async-runtime.js';
import {
  varargsCall
} from './varargs.js';
import {
  invokeSynchronization
} from './sync-primitives.js';

const adapters = Object.freeze([invokeMemoryRuntime, invokeAsyncIntrinsic, varargsCall, invokeFrameworkInterface]);

/** Subsystem calls use explicit finite adapters before ordinary managed allocation or intrinsic dispatch. */
export function invokeRuntimeCall(vm, descriptor, args, opcode) {
  for (const adapter of adapters) {
    const result = adapter(vm, descriptor, args, opcode);
    if (result.handled) return result;
  }
  const result = invokeSynchronization(vm, descriptor, args);
  return result.handled ? {
    ...result,
    returns: descriptor.signature.returnType !== 'void'
  } : result;
}
