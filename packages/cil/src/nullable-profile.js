import {genericTypeParts, substituteCallType} from './generic-signatures.js';

const canonical = type => type === 'decimal' ? 'System.Decimal' : type;

/** Closed Nullable instance contracts, also permitting verified symbolic type arguments. */
export function nullableMethodDefinition(descriptor) {
  const signature = descriptor?.signature;
  if (descriptor?.kind !== 'method' || !signature || signature.isStatic || signature.genericArity ||
      signature.callingConvention || descriptor.genericArguments || descriptor.methodArguments?.length) return null;
  const generic = genericTypeParts(descriptor.ownerInstance ?? descriptor.owner);
  if (generic.definition !== 'System.Nullable`1' || generic.arguments.length !== 1) return null;
  const element = canonical(substituteCallType(generic.arguments[0]));
  const parameters = signature.parameters.map(type => canonical(substituteCallType(type, [element])));
  const result = canonical(substituteCallType(signature.returnType, [element]));
  let operation;
  if (descriptor.name === '.ctor' && parameters.length === 1 && parameters[0] === element && result === 'void') operation = 'construct';
  if (descriptor.name === 'get_HasValue' && !parameters.length && result === 'bool') operation = 'hasValue';
  if (descriptor.name === 'get_Value' && !parameters.length && result === element) operation = 'value';
  if (descriptor.name === 'GetValueOrDefault' && result === element &&
      (!parameters.length || parameters.length === 1 && parameters[0] === element)) operation = 'default';
  if (descriptor.name === 'ToString' && !parameters.length && result === 'string') operation = 'text';
  return operation ? {implementation: 'nullable', operation, descriptor,
    owner: 'System.Nullable`1<' + element + '>', element, contract: null} : null;
}
