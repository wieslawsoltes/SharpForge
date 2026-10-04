import {memorySignature, managedMemoryElement} from './memory-signatures.js';

const equal = (left, right) => left.length === right.length && left.every((type, index) => type === right[index]);

function runtimeOperation(name, call) {
  const {owner, parameters, result, isStatic, arity, arguments: arguments_} = call;
  if (owner === 'System.Runtime.CompilerServices.RuntimeHelpers') {
    return !arity && isStatic && name === 'InitializeArray' && result === 'void' &&
      equal(parameters, ['System.Array', 'System.RuntimeFieldHandle']) ? 'initialize' : null;
  }
  if (owner !== 'System.Array') return null;
  if (!arity && !isStatic && name === 'Clone' && !parameters.length && result === 'object') return 'clone';
  if (!isStatic) return null;
  if (!arity && name === 'Copy' && result === 'void') {
    for (const index of ['int', 'long']) {
      if (equal(parameters, ['System.Array', 'System.Array', index]) ||
          equal(parameters, ['System.Array', index, 'System.Array', index, index])) return 'copy';
    }
  }
  if (!arity && name === 'Clear' && result === 'void' &&
      (equal(parameters, ['System.Array']) || equal(parameters, ['System.Array', 'int', 'int']))) return 'clear';
  const element = arity === 1 && managedMemoryElement(arguments_[0]) ? arguments_[0] : null;
  if (element && name === 'Resize' && result === 'void' && equal(parameters, [element + '[]&', 'int'])) return 'resize';
  if (name === 'IndexOf' && result === 'int' && parameters.length >= 2 && parameters.length <= 4 &&
      parameters.slice(2).every(type => type === 'int') &&
      ((!arity && equal(parameters.slice(0, 2), ['System.Array', 'object'])) ||
        element && equal(parameters.slice(0, 2), [element + '[]', element]))) return 'indexOf';
  return null;
}

/** Exact framework array contracts, including concrete or verified symbolic MethodSpec arguments. */
export function arrayRuntimeDefinition(descriptor) {
  const call = memorySignature(descriptor);
  if (!call) return null;
  const operation = runtimeOperation(descriptor.name, call);
  return operation ? Object.freeze({implementation: 'arrayRuntime', descriptor, operation,
    element: call.arguments[0] ?? null, contract: null}) : null;
}
