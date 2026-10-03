import {genericTypeParts} from './field-profile.js';
import {callStorageType, substituteCallType} from './call-profile.js';

const aliases = new Map([
  ['System.Int32', 'int'], ['System.Int64', 'long'], ['System.Single', 'float'], ['System.Double', 'double'],
  ['System.Boolean', 'bool'], ['System.Byte', 'byte'], ['System.Void', 'void']
]);
const canonical = type => aliases.get(callStorageType(type)) ?? callStorageType(type);

/** Closed metadata contracts for frame-owned memory, Span and Nullable. */
export function memoryMethodDefinition(descriptor) {
  if (descriptor?.kind !== 'method' || !descriptor.signature || descriptor.signature.callingConvention) return null;
  const {name, signature} = descriptor;
  const owner = descriptor.ownerInstance ?? descriptor.owner;
  const generic = genericTypeParts(owner);
  const element = generic.arguments[0];
  const arguments_ = descriptor.methodArguments ?? descriptor.genericArguments ?? [];
  const parameter = signature.parameters.map(type => canonical(substituteCallType(type, generic.arguments, arguments_)));
  const result = canonical(substituteCallType(signature.returnType, generic.arguments, arguments_));
  const span = ['System.Span`1', 'System.ReadOnlySpan`1'].includes(generic.definition) && generic.arguments.length === 1;
  let operation = null;
  if (span) {
    if (name === '.ctor' && !signature.isStatic && result === 'void' && (
      parameter.join(',') === 'void*,int' || parameter.join(',') === element + '[]' ||
      parameter.join(',') === element + '[],int,int')) operation = 'spanCtor';
    if (!signature.isStatic && parameter.length === 0 && name === 'get_Length' && result === 'int') operation = 'spanLength';
    if (!signature.isStatic && parameter.length === 0 && name === 'get_IsEmpty' && result === 'bool') operation = 'spanEmpty';
    if (!signature.isStatic && name === 'get_Item' && parameter.join(',') === 'int' && result === element + '&') operation = 'spanItem';
    if (!signature.isStatic && name === 'Slice' && ['int', 'int,int'].includes(parameter.join(',')) && result === owner) operation = 'spanSlice';
    if (!signature.isStatic && name === 'ToArray' && parameter.length === 0 && result === element + '[]') operation = 'spanArray';
    if (!signature.isStatic && name === 'GetPinnableReference' && parameter.length === 0 && result === element + '&') operation = 'spanPin';
    if (signature.isStatic && name === 'op_Implicit' && parameter.length === 1 && result === owner &&
        [element + '[]', 'System.Span`1<' + element + '>'].includes(parameter[0])) operation = 'spanConvert';
  }
  if (generic.definition === 'System.Nullable`1' && element && !signature.isStatic) {
    if (name === '.ctor' && parameter.join(',') === element && result === 'void') operation = 'nullableCtor';
    if (name === 'get_HasValue' && !parameter.length && result === 'bool') operation = 'nullableHasValue';
    if (name === 'get_Value' && !parameter.length && result === element) operation = 'nullableValue';
    if (name === 'GetValueOrDefault' && (!parameter.length || parameter.join(',') === element) && result === element) operation = 'nullableDefault';
  }
  if (owner === 'System.Runtime.CompilerServices.Unsafe' && signature.isStatic && name === 'As' &&
      arguments_.length === 2 && parameter.join(',') === arguments_[0] + '&' && result === arguments_[1] + '&') operation = 'reinterpret';
  if (owner === 'System.BitConverter' && signature.isStatic) {
    if (name === 'GetBytes' && parameter.length === 1 && result === 'byte[]') operation = 'bitBytes';
    if (/^To(Int16|UInt16|Int32|UInt32|Int64|UInt64|Single|Double|Char|Boolean)$/.test(name) &&
        parameter.join(',') === 'byte[],int') operation = 'bitValue';
    if (['DoubleToInt64Bits', 'Int64BitsToDouble', 'SingleToInt32Bits', 'Int32BitsToSingle'].includes(name) &&
        parameter.length === 1) operation = 'bitScalar';
  }
  return operation ? {implementation: 'memory', descriptor, operation, element, owner, contract: null} : null;
}
