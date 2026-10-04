import {canonicalType} from '@sharpforge/framework';
import {genericTypeParts, substituteCallType} from './generic-signatures.js';

/** Approved nullable values at the UI ABI boundary; general CLR Nullable contracts are resolved below. */
export const nullableScalarTypes = Object.freeze(['int', 'uint', 'bool', 'float', 'double']);
export const nullableValueTypes = Object.freeze([...nullableScalarTypes, 'System.DateTimeOffset', 'System.TimeSpan']);
const values = new Set(nullableValueTypes);
const scalarAliases = new Map([
  ['System.Int32', 'int'], ['System.UInt32', 'uint'], ['System.Boolean', 'bool'],
  ['System.Single', 'float'], ['System.Double', 'double']
]);

export function nullableElementType(type) {
  if (typeof type !== 'string' || type.length > 128) return null;
  if (!type.endsWith('?') && !type.startsWith('System.Nullable')) return null;
  const element = type.endsWith('?') ? type.slice(0, -1) : /^System\.Nullable(?:`1)?<([^<>]+)>$/.exec(type)?.[1];
  if (!element) return null;
  const spelling = element.trim();
  const name = scalarAliases.get(spelling) ?? canonicalType(spelling);
  return values.has(name) ? name : null;
}

export function nullableSignatureType(type) {
  const element = nullableElementType(type);
  return element ? element + '?' : canonicalType(type);
}

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
