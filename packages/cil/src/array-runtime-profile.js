import {callStorageType, substituteCallType} from './call-profile.js';

const primitiveAlias = new Map([['System.Int32', 'int'], ['System.Int64', 'long'], ['System.Object', 'object'], ['System.Void', 'void']]);
const typeName = type => primitiveAlias.get(callStorageType(type)) ?? callStorageType(type);

/** System.Array and FieldRVA contracts, including closed generic MethodSpecs. */
export function arrayRuntimeDefinition(descriptor) {
  if (descriptor?.kind !== 'method' || !descriptor.signature || descriptor.signature.callingConvention) return null;
  const {owner, name, signature} = descriptor;
  const arguments_ = descriptor.methodArguments ?? descriptor.genericArguments ?? [];
  const parameters = signature.parameters.map(type => typeName(substituteCallType(type, [], arguments_)));
  const result = typeName(substituteCallType(signature.returnType, [], arguments_));
  const array = parameters[0];
  const vector = array === 'System.Array' || array?.endsWith('[]');
  let operation = null;
  if (owner === 'System.Runtime.CompilerServices.RuntimeHelpers' && name === 'InitializeArray' && signature.isStatic &&
      parameters.join(',') === 'System.Array,System.RuntimeFieldHandle' && result === 'void') operation = 'initialize';
  if (owner !== 'System.Array' && !operation) return null;
  if (!signature.isStatic && name === 'Clone' && !parameters.length && result === 'object') operation = 'clone';
  if (signature.isStatic && result === 'void') {
    if (name === 'Copy' && (parameters.join(',') === 'System.Array,System.Array,int' ||
        parameters.join(',') === 'System.Array,int,System.Array,int,int' ||
        parameters.join(',') === 'System.Array,System.Array,long' ||
        parameters.join(',') === 'System.Array,long,System.Array,long,long')) operation = 'copy';
    if (name === 'Clear' && vector && (parameters.length === 1 || parameters.slice(1).join(',') === 'int,int')) operation = 'clear';
    if (name === 'Resize' && arguments_.length === 1 && parameters.join(',') === arguments_[0] + '[]&,int') operation = 'resize';
  }
  if (signature.isStatic && name === 'IndexOf' && result === 'int' && vector && parameters.length >= 2 && parameters.length <= 4 &&
      parameters.slice(2).every(type => type === 'int') &&
      (parameters[1] === 'object' && array === 'System.Array' || parameters[1] + '[]' === array)) operation = 'indexOf';
  return operation ? {implementation: 'arrayRuntime', descriptor, operation, element: arguments_[0] ?? null, contract: null} : null;
}
