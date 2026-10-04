import {arrayRuntimeDefinition} from './array-runtime-profile.js';
import {arraySignatureShape, memorySignature, managedMemoryElement} from './memory-signatures.js';

function rectangularOperation(name, call, shape) {
  const {parameters, result, isStatic} = call;
  const {rank, element} = shape;
  if (isStatic || shape.vector || !managedMemoryElement(element)) return null;
  const indices = parameters.slice(0, rank).every(type => type === 'int');
  if (name === '.ctor' && result === 'void' && parameters.every(type => type === 'int') &&
      (parameters.length === rank || parameters.length === rank * 2)) return 'construct';
  if (parameters.length === rank && indices) {
    if (name === 'Get' && result === element) return 'get';
    if (name === 'Address' && result === element + '&') return 'address';
  }
  if (name === 'Set' && parameters.length === rank + 1 && indices && parameters[rank] === element && result === 'void') return 'set';
  return null;
}

function reflectionIndices(parameters) {
  return parameters.length === 1 && ['int[]', 'long[]'].includes(parameters[0]) ||
    parameters.length >= 1 && parameters.length <= 3 && ['int', 'long'].some(type => parameters.every(value => value === type));
}

function arrayOperation(name, call) {
  const {parameters, result, isStatic} = call;
  if (isStatic) {
    if (name !== 'CreateInstance' || result !== 'System.Array' || parameters[0] !== 'System.Type') return null;
    const lengths = parameters.slice(1);
    if (lengths.length >= 1 && lengths.length <= 3 && lengths.every(type => type === 'int') ||
        lengths.length === 1 && ['int[]', 'long[]'].includes(lengths[0]) ||
        lengths.length === 2 && lengths.every(type => type === 'int[]')) return 'create';
    return null;
  }
  if (!parameters.length) {
    if (name === 'get_Rank' && result === 'int') return 'rank';
    if (name === 'get_Length' && result === 'int') return 'length';
    if (name === 'get_LongLength' && result === 'long') return 'longLength';
  }
  if (parameters.length === 1 && parameters[0] === 'int' &&
      (['GetLength', 'GetLowerBound', 'GetUpperBound'].includes(name) && result === 'int' ||
       name === 'GetLongLength' && result === 'long')) return name;
  if (name === 'GetValue' && result === 'object' && reflectionIndices(parameters)) return 'getValue';
  if (name === 'SetValue' && result === 'void' && parameters[0] === 'object' && reflectionIndices(parameters.slice(1))) return 'setValue';
  return null;
}

/** Array pseudo-methods must match their exact rank, element and byref return signature. */
export function arrayMethodDefinition(descriptor) {
  const runtime = arrayRuntimeDefinition(descriptor);
  if (runtime) return runtime;
  const call = memorySignature(descriptor);
  if (!call || call.arity) return null;
  const shape = arraySignatureShape(call.owner);
  const operation = shape ? rectangularOperation(descriptor.name, call, shape)
    : call.owner === 'System.Array' ? arrayOperation(descriptor.name, call) : null;
  return operation ? Object.freeze({implementation: 'array', descriptor, operation,
    rank: shape?.rank, elementType: shape?.element, contract: null}) : null;
}
