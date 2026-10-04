import {
  normalizeCallType
} from './call-profile.js';

const delegate = 'System.Delegate';
const definitions = new Map([
  ['Combine', [
    [true, [delegate, delegate], delegate],
    [true, [delegate + '[]'], delegate]
  ]],
  ['Remove', [
    [true, [delegate, delegate], delegate]
  ]],
  ['RemoveAll', [
    [true, [delegate, delegate], delegate]
  ]],
  ['op_Equality', [
    [true, [delegate, delegate], 'bool']
  ]],
  ['op_Inequality', [
    [true, [delegate, delegate], 'bool']
  ]],
  ['GetInvocationList', [
    [false, [], delegate + '[]']
  ]]
]);

/** Multicast operations are admitted only by their exact managed signatures. */
export function supportedDelegateOperation(descriptor) {
  if (!['System.Delegate', 'System.MulticastDelegate'].includes(descriptor.owner)) return false;
  const signature = descriptor.signature;
  if (signature.genericArity || signature.callingConvention) return false;
  return definitions.get(descriptor.name)?.some(([isStatic, parameters, result]) =>
    !!signature.isStatic === isStatic && normalizeCallType(signature.returnType) === normalizeCallType(result) &&
    signature.parameters.length === parameters.length && parameters.every((type, index) =>
      normalizeCallType(type) === normalizeCallType(signature.parameters[index]))) ?? false;
}
