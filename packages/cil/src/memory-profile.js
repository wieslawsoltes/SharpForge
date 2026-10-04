import {managedMemoryElement, memorySignature, readonlyMemoryResult} from './memory-signatures.js';

const bitValues = Object.freeze({
  ToBoolean: 'bool', ToChar: 'char', ToInt16: 'short', ToUInt16: 'ushort', ToInt32: 'int',
  ToUInt32: 'uint', ToInt64: 'long', ToUInt64: 'ulong', ToSingle: 'float', ToDouble: 'double'
});
const equal = (left, right) => left.length === right.length && left.every((type, index) => type === right[index]);

function spanOperation(name, call) {
  const {generic, parameters, isStatic, owner} = call;
  const readonly = generic.definition === 'System.ReadOnlySpan`1';
  if (call.arity || !['System.Span`1', 'System.ReadOnlySpan`1'].includes(generic.definition) ||
      generic.arguments.length !== 1 || !managedMemoryElement(generic.arguments[0])) return null;
  const element = generic.arguments[0];
  const result = readonly ? readonlyMemoryResult(call.result) : call.result;
  let operation, resultOwner = owner;
  if (!isStatic) {
    if (name === '.ctor' && result === 'void' &&
        (equal(parameters, ['void*', 'int']) || equal(parameters, [element + '[]']) ||
          equal(parameters, [element + '[]', 'int', 'int']))) operation = 'spanCtor';
    if (!parameters.length) {
      if (name === 'get_Length' && result === 'int') operation = 'spanLength';
      if (name === 'get_IsEmpty' && result === 'bool') operation = 'spanEmpty';
      if (name === 'ToArray' && result === element + '[]') operation = 'spanArray';
      if (name === 'GetPinnableReference' && result === element + '&') operation = 'spanPin';
    }
    if (name === 'get_Item' && equal(parameters, ['int']) && result === element + '&') operation = 'spanItem';
    if (name === 'Slice' && result === owner &&
        (equal(parameters, ['int']) || equal(parameters, ['int', 'int']))) operation = 'spanSlice';
  } else if (name === 'op_Implicit' && parameters.length === 1) {
    const mutable = 'System.Span`1<' + element + '>', immutable = 'System.ReadOnlySpan`1<' + element + '>';
    if (parameters[0] === element + '[]' && result === owner ||
        owner === mutable && parameters[0] === mutable && result === immutable) {
      operation = 'spanConvert';
      resultOwner = result;
    }
  }
  return operation ? {operation, element, owner: resultOwner} : null;
}

function scalarOperation(name, call) {
  const {owner, parameters, result, isStatic, arity, arguments: arguments_} = call;
  if (!isStatic) return null;
  if (owner === 'string' && !arity && name === 'op_Implicit' && equal(parameters, ['string']) &&
      result === 'System.ReadOnlySpan`1<char>') {
    return {operation: 'spanString', owner: result, element: 'char'};
  }
  if (owner === 'System.Runtime.CompilerServices.Unsafe' && name === 'As' && arity === 2 &&
      arguments_.every(managedMemoryElement) && equal(parameters, [arguments_[0] + '&']) && result === arguments_[1] + '&') {
    return {operation: 'reinterpret', owner, element: null};
  }
  if (owner !== 'System.BitConverter' || arity) return null;
  if (name === 'GetBytes' && parameters.length === 1 && Object.values(bitValues).includes(parameters[0]) && result === 'byte[]') {
    return {operation: 'bitBytes', owner, element: null};
  }
  if (Object.hasOwn(bitValues, name) && equal(parameters, ['byte[]', 'int']) && result === bitValues[name]) {
    return {operation: 'bitValue', owner, element: null};
  }
  return null;
}

/** Add memory contracts without replacing existing Nullable or scalar BitConverter implementations. */
export function memoryMethodDefinition(descriptor) {
  const call = memorySignature(descriptor);
  if (!call) return null;
  const definition = spanOperation(descriptor.name, call) ?? scalarOperation(descriptor.name, call);
  return definition ? Object.freeze({implementation: 'memory', descriptor, ...definition, contract: null}) : null;
}
