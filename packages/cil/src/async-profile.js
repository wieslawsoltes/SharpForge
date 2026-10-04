import {genericTypeParts, normalizeCallType, substituteCallType} from './generic-signatures.js';

export const asyncTypes = Object.freeze({
  task: 'System.Threading.Tasks.Task',
  builder: 'System.Runtime.CompilerServices.AsyncTaskMethodBuilder',
  awaiter: 'System.Runtime.CompilerServices.TaskAwaiter',
  yieldable: 'System.Runtime.CompilerServices.YieldAwaitable',
  yieldAwaiter: 'System.Runtime.CompilerServices.YieldAwaitable+YieldAwaiter',
  machine: 'System.Runtime.CompilerServices.IAsyncStateMachine',
  notify: 'System.Runtime.CompilerServices.INotifyCompletion',
  critical: 'System.Runtime.CompilerServices.ICriticalNotifyCompletion'
});

const generic = (type, element) => element === null ? type : type + '`1<' + element + '>';

/** Intrinsic ABI value identity, including open generic definitions used by MethodTables. */
export function asyncValueType(input) {
  const type = normalizeCallType(input), parts = genericTypeParts(type);
  for (const kind of ['builder', 'awaiter']) {
    if (parts.definition === asyncTypes[kind] && !parts.arguments.length) return {kind, type, element: null};
    if (parts.definition === asyncTypes[kind] + '`1' && parts.arguments.length <= 1) {
      return {kind, type, element: parts.arguments[0] ?? '!0'};
    }
  }
  if (type === asyncTypes.yieldable) return {kind: 'yieldable', type, element: null};
  if (type === asyncTypes.yieldAwaiter) return {kind: 'yieldAwaiter', type, element: null};
  return null;
}

function selectOperation(descriptor, owner, match) {
  const {name} = descriptor;
  const value = asyncValueType(owner);
  if (value?.kind === 'builder') {
    const task = generic(asyncTypes.task, value.element);
    if (match('Create', [], owner, true)) return ['create', value];
    if (match('get_Task', [], task)) return ['task', value];
    if (match('SetResult', value.element === null ? [] : [value.element], 'void')) return ['result', value];
    if (match('SetException', ['System.Exception'], 'void')) return ['exception', value];
    if (match('SetStateMachine', [asyncTypes.machine], 'void')) return ['setMachine', value];
    if (match('Start', ['!!0&'], 'void', false, 1)) return ['start', value];
    if (['AwaitOnCompleted', 'AwaitUnsafeOnCompleted'].includes(name) && match(name, ['!!0&', '!!1&'], 'void', false, 2)) {
      return ['await', value];
    }
  }
  if (value?.kind === 'awaiter' || value?.kind === 'yieldAwaiter') {
    if (match('get_IsCompleted', [], 'bool')) return ['completed', value];
    if (match('GetResult', [], value.element ?? 'void')) return ['getResult', value];
    if (['OnCompleted', 'UnsafeOnCompleted'].includes(name) && match(name, ['System.Action'], 'void')) return ['notify', value];
  }
  if (value?.kind === 'yieldable' && match('GetAwaiter', [], asyncTypes.yieldAwaiter)) return ['yieldAwaiter', value];
  const parts = genericTypeParts(owner);
  const task = parts.definition === asyncTypes.task && !parts.arguments.length
    || parts.definition === asyncTypes.task + '`1' && parts.arguments.length === 1;
  if (!task) return null;
  const element = parts.arguments[0] ?? null;
  const shape = {kind: 'task', type: owner, element};
  if (match('GetAwaiter', [], generic(asyncTypes.awaiter, element))) return ['getAwaiter', shape];
  if (['get_IsCompleted', 'get_IsFaulted', 'get_IsCanceled'].includes(name) && match(name, [], 'bool')) return ['status', shape];
  if (match('Wait', [], 'void')) return ['wait', shape];
  if (element !== null && match('get_Result', [], element)) return ['getTaskResult', shape];
  if (element !== null) return null;
  if (match('get_CompletedTask', [], asyncTypes.task, true)) return ['completedTask', shape];
  if (match('Delay', ['int'], asyncTypes.task, true)) return ['delay', shape];
  if (match('Yield', [], asyncTypes.yieldable, true)) return ['yield', shape];
  if (match('FromResult', ['!!0'], generic(asyncTypes.task, '!!0'), true, 1)) return ['fromResult', shape];
  return null;
}

/** Exact substituted member contract; malformed overloads and unsupported async families stay unregistered. */
export function asyncMethodDefinition(descriptor) {
  const signature = descriptor?.signature;
  if (descriptor?.kind !== 'method' || !signature || signature.callingConvention || descriptor.resolvedToken ||
      descriptor.token >>> 24 === 6 || descriptor.definitionToken >>> 24 === 6) return null;
  const owner = normalizeCallType(descriptor.ownerInstance ?? descriptor.owner);
  const ownerArguments = genericTypeParts(owner).arguments;
  if (!ownerArguments.length && owner.endsWith('`1')) return null;
  const arguments_ = descriptor.methodArguments ?? descriptor.genericArguments ?? [];
  const arity = signature.genericArity ?? 0;
  if (arguments_.length !== arity || arity && !descriptor.genericArguments) return null;
  const close = type => {
    const value = substituteCallType(type, ownerArguments, arguments_);
    return value === 'Exception' ? 'System.Exception' : value;
  };
  const parameters = signature.parameters.map(close), result = close(signature.returnType);
  const match = (name, expected, returns, isStatic = false, genericArity = 0) =>
    descriptor.name === name && signature.isStatic === isStatic && arity === genericArity &&
    result === close(returns) && parameters.length === expected.length && parameters.every((type, index) => type === close(expected[index]));
  const selected = selectOperation(descriptor, owner, match);
  return selected ? {implementation: 'async', operation: selected[0], ...selected[1], descriptor,
    methodArguments: arguments_, contract: null} : null;
}
