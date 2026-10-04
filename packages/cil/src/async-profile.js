import {
  genericTypeParts
} from './field-profile.js';
import {
  callSignatureKey,
  instantiateSignature,
  normalizeCallType
} from './call-profile.js';

const C = 'System.Runtime.CompilerServices.',
  T = 'System.Threading.Tasks.Task';
const builderNames = new Set([C + 'AsyncTaskMethodBuilder', C + 'AsyncTaskMethodBuilder`1', C + 'AsyncVoidMethodBuilder']);
const awaiterNames = new Set([C + 'TaskAwaiter', C + 'TaskAwaiter`1', C + 'YieldAwaitable+YieldAwaiter']);
const records = [];

function add(owner, name, parameters, returnType, isStatic, operation, genericArity = 0) {
  records.push(Object.freeze({
    owner,
    name,
    signature: Object.freeze({
      kind: 'method',
      parameters: Object.freeze(parameters),
      returnType,
      isStatic,
      genericArity
    }),
    operation
  }));
}
for (const owner of builderNames) {
  const generic = owner.endsWith('`1'),
    voidBuilder = owner.endsWith('AsyncVoidMethodBuilder'),
    self = generic ? owner + '<!0>' : owner;
  add(owner, 'Create', [], self, true, 'builder-create');
  add(owner, 'Start', ['!!0&'], 'void', false, 'builder-start', 1);
  add(owner, 'SetStateMachine', [C + 'IAsyncStateMachine'], 'void', false, 'builder-set-state-machine');
  add(owner, 'SetException', ['System.Exception'], 'void', false, 'builder-set-exception');
  add(owner, 'SetResult', generic ? ['!0'] : [], 'void', false, 'builder-set-result');
  for (const name of ['AwaitOnCompleted', 'AwaitUnsafeOnCompleted']) add(owner, name, ['!!0&', '!!1&'], 'void', false, 'builder-await', 2);
  if (!voidBuilder) add(owner, 'get_Task', [], generic ? T + '`1<!0>' : T, false, 'builder-task');
}
for (const owner of awaiterNames) {
  add(owner, 'get_IsCompleted', [], 'bool', false, 'awaiter-completed');
  add(owner, 'GetResult', [], owner.endsWith('`1') ? '!0' : 'void', false, 'awaiter-result');
  for (const name of ['OnCompleted', 'UnsafeOnCompleted']) add(owner, name, ['System.Action'], 'void', false, 'awaiter-continuation');
}
add(T, 'GetAwaiter', [], C + 'TaskAwaiter', false, 'task-awaiter');
add(T + '`1', 'GetAwaiter', [], C + 'TaskAwaiter`1<!0>', false, 'task-awaiter');
add(T, 'Yield', [], C + 'YieldAwaitable', true, 'task-yield');
add(C + 'YieldAwaitable', 'GetAwaiter', [], C + 'YieldAwaitable+YieldAwaiter', false, 'yield-awaiter');
add('System.Environment', 'get_CurrentManagedThreadId', [], 'int', true, 'logical-thread-id');
export const asyncIntrinsicDefinitions = Object.freeze(records);

/** Finite compiler infrastructure contracts. BCL Task scheduling stays with A11. */
export function asyncMethodDefinition(descriptor) {
  if (descriptor?.kind !== 'method' || !descriptor.signature || descriptor.signature.callingConvention) return null;
  const parts = genericTypeParts(descriptor.ownerInstance ?? descriptor.owner),
    methodArguments = descriptor.methodArguments ?? descriptor.genericArguments ?? [];
  for (const definition of records) {
    if (definition.owner !== parts.definition || definition.name !== descriptor.name || (definition.signature.genericArity ?? 0) !== (descriptor
        .signature.genericArity ?? 0)) continue;
    if ((definition.owner.endsWith('`1') ? 1 : 0) !== parts.arguments.length) continue;
    if (definition.signature.genericArity && methodArguments.length !== definition.signature.genericArity) continue;
    if (definition.operation === 'builder-await' && !awaiterNames.has(genericTypeParts(methodArguments[0]).definition) && !/^!!?\d+$/.test(
        methodArguments[0])) continue;
    const expected = instantiateSignature(definition.signature, parts.arguments, methodArguments);
    if (callSignatureKey(expected) !== callSignatureKey(descriptor.signature)) continue;
    return {
      ...definition,
      implementation: 'async',
      owner: descriptor.ownerInstance ?? descriptor.owner,
      ownerKind: builderNames.has(parts.definition) ? 'builder' : awaiterNames.has(parts.definition) ? 'awaiter' : 'infrastructure',
      resultType: parts.arguments[0] ?? 'void',
      signature: expected,
      methodArguments
    };
  }
  return null;
}

/** Pure MethodTable descriptors; private fields use the normal value-copy/GC path. */
export function asyncTypeDefinition(name) {
  if (builderNames.has(name) || awaiterNames.has(name) || name === C + 'YieldAwaitable') {
    return {
      name,
      base: 'System.ValueType',
      flags: {
        valueType: true,
        sealed: true,
        runtimeValue: true
      },
      fields: [{
        name: '$task',
        type: 'object'
      }],
      interfaces: awaiterNames.has(name) ? [C + 'ICriticalNotifyCompletion'] : [],
      ...(name.endsWith('`1') ? {
        variance: [0]
      } : {})
    };
  }
  if (name === C + 'IAsyncStateMachine' || name === C + 'INotifyCompletion') return {
    name,
    base: null,
    flags: {
      interface: true
    }
  };
  if (name === C + 'ICriticalNotifyCompletion') return {
    name,
    base: null,
    flags: {
      interface: true
    },
    interfaces: [C + 'INotifyCompletion']
  };
  return null;
}

/** Start/Await call infrastructure reaches MoveNext without an explicit IL call. */
export function reachableAsyncMethods(inspector, descriptor) {
  const definition = asyncMethodDefinition(descriptor),
    result = new Set();
  if (!definition || !['builder-start', 'builder-await'].includes(definition.operation)) return result;
  const argument = definition.methodArguments[definition.operation === 'builder-start' ? 0 : 1],
    parts = genericTypeParts(argument),
    open = /!!?\d+/.test(argument);
  for (const type of inspector.types) {
    if (!open && normalizeCallType(type.name) !== normalizeCallType(parts.definition)) continue;
    if (!type.interfaces.some(token => inspector.metadata.typeName(token) === C + 'IAsyncStateMachine')) continue;
    for (const method of type.methods)
      if (method.hasBody && (method.name === 'MoveNext' || method.name.endsWith('.MoveNext') || method.name === 'SetStateMachine' || method.name
          .endsWith('.SetStateMachine'))) result.add(method.token);
  }
  return result;
}
