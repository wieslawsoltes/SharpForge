import {callSignatureKey} from '@sharpforge/cil';
import {cachedMethod, verifiedMethod} from './token-cache.js';
import {ManagedFault} from '../heap.js';

function referencesFrame(value, frameId) {
  if (!value || typeof value !== 'object') return false;
  if (value.byref && value.frameId === frameId) return true;
  if (value.span) return referencesFrame(value.pointer, frameId);
  if (value.typedReference) return referencesFrame(value.pointer, frameId);
  return value.valueType && value.fields?.some(field => referencesFrame(field, frameId)) || false;
}

/** Tail requests may fall back without changing result or invalidating local references. */
export function eligibleTailCall(frame, args) {
  return !!frame && !frame.initializes && !frame.filterSearch && !frame.pending &&
    !frame.unwinds.length && !args.some(value => referencesFrame(value, frame.id));
}

export function inheritedTailState(frame) {
  return {
    delegateContinuation: frame.delegateContinuation,
    exceptionEventContinuation: frame.exceptionEventContinuation,
    returnObject: frame.returnObject,
    valueConstructor: frame.valueConstructor,
    valueConstructorType: frame.valueConstructorType,
    asyncBuilderTask: frame.asyncBuilderTask
  };
}

/** jmp transfers current arguments and requires exact signature compatibility. */
export function jumpMethod(vm, frame, instruction) {
  const descriptor = cachedMethod(vm, instruction.operand, frame);
  if (frame.stack.length || callSignatureKey(descriptor.signature) !== callSignatureKey(frame.method.signature)) {
    throw new ManagedFault('InvalidProgramException', 'jmp requires an empty stack and matching method signature');
  }
  if (!descriptor.resolvedToken || !verifiedMethod(vm, descriptor.resolvedToken)) {
    throw new ManagedFault('NotSupportedException', 'jmp target is unavailable: ' + descriptor.owner + '::' + descriptor.name);
  }
  if (!eligibleTailCall(frame, frame.args)) {
    throw new ManagedFault('InvalidProgramException', 'jmp cannot invalidate local references or active exception state');
  }
  vm.call(descriptor.resolvedToken, [...frame.args], {
    tail: true, genericIdentity: descriptor.ownerInstance,
    methodArguments: descriptor.methodArguments ?? []
  });
}
