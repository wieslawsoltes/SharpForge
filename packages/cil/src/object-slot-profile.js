import {normalizeCallType} from './generic-signatures.js';

const slots = Object.freeze({
  ToString: Object.freeze({parameters: Object.freeze([]), returnType: 'string'}),
  GetHashCode: Object.freeze({parameters: Object.freeze([]), returnType: 'int'}),
  Equals: Object.freeze({parameters: Object.freeze(['object']), returnType: 'bool'})
});

/** Exact ordinary Object virtual signatures; similarly named overloads are distinct slots. */
export function objectSlotSignature(name, signature) {
  const slot = Object.hasOwn(slots, name) ? slots[name] : null;
  return !!slot && !!signature && !signature.isStatic && !signature.genericArity && !signature.callingConvention &&
    signature.parameters.length === slot.parameters.length &&
    normalizeCallType(signature.returnType) === slot.returnType &&
    signature.parameters.every((type, index) => normalizeCallType(type) === slot.parameters[index]);
}

export function objectSlotDeclaration(descriptor) {
  return descriptor.kind === 'method' && descriptor.owner === 'System.Object' &&
    descriptor.ownerToken >>> 24 === 1 && !descriptor.resolvedToken && descriptor.token >>> 24 === 10 &&
    descriptor.definitionToken >>> 24 !== 6 && !descriptor.methodArguments?.length && !descriptor.typeArguments?.length &&
    objectSlotSignature(descriptor.name, descriptor.signature);
}

export function slotCache(cache, name) {
  let entries = cache.get(name);
  if (!entries) cache.set(name, entries = new Map());
  return entries;
}
