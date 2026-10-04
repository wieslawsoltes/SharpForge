import {asyncTypes, asyncStateMachine} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {SUSPENDED} from '../platform.js';
import {asyncTaskValue, asyncValue} from './async-values.js';
import {inspectManagedAddress} from './managed-address.js';
import {boxValue} from './boxing.js';
import {verifiedMethod} from './token-cache.js';
import {registerAsyncContinuation} from './async-continuations.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);
const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };

function readValue(vm, definition, receiver) {
  const table = vm.typeSystem.table(definition.type);
  const location = inspectManagedAddress(vm, receiver);
  if (vm.typeSystem.table(location.type) !== table) invalid('Async ABI receiver requires its exact managed storage type');
  return asyncValue(vm, table, vm.dereference(receiver));
}

function builderTask(vm, definition, receiver) {
  const value = readValue(vm, definition, receiver);
  let reference = value.fields[0];
  if (reference === null) {
    reference = vm.scheduler.createTask(definition.element ?? 'void').ref;
    vm.heap.withRoots([reference], () => vm.dereference(receiver, true, asyncTaskValue(vm, definition.type, reference)));
  }
  return vm.scheduler.taskRecord(reference);
}

function machineArgument(vm, type, address) {
  const machine = asyncStateMachine(vm.inspector, type);
  if (!machine || !verifiedMethod(vm, machine.moveNext) || !verifiedMethod(vm, machine.setStateMachine)) {
    invalid('Async state-machine callbacks were not admitted by the verifier');
  }
  const location = inspectManagedAddress(vm, address);
  const table = vm.typeSystem.table(type);
  if (location.readonly || vm.typeSystem.table(location.type) !== table) invalid('Async state machine requires exact writable ref storage');
  const value = vm.dereference(address);
  if (machine.valueType) vm.storage(value, table.name);
  else if (value === null || vm.heap.get(value).methodTable !== table) invalid('Async state-machine reference type mismatch');
  return {machine, table, value};
}

function start(vm, definition, args) {
  const task = builderTask(vm, definition, args[0]);
  const type = definition.methodArguments[0], {machine, value} = machineArgument(vm, type, args[1]);
  if (!machine.valueType) task.asyncMachine = Object.freeze({kind: 'machine', type, method: machine.moveNext, receiver: value});
  vm.call(machine.moveNext, [machine.valueType ? args[1] : value], {genericIdentity: type.includes('<') ? type : null});
  return SUSPENDED;
}

function stableMachine(vm, task, type, address) {
  const {machine, value} = machineArgument(vm, type, address);
  if (task.asyncMachine) {
    if (task.asyncMachine.type !== type) invalid('A task builder cannot change its state-machine type');
    return {continuation: task.asyncMachine, promoted: false};
  }
  const receiver = machine.valueType ? boxValue(vm, value, type) : value;
  const continuation = Object.freeze({kind: 'machine', type, method: machine.moveNext, receiver});
  task.asyncMachine = continuation;
  return {continuation, promoted: machine.valueType, machine};
}

function yieldTask(vm) {
  return vm.scheduler.createTask('void', {deadline: vm.scheduler.now(), readyTurn: vm.scheduler.turn + 1});
}

function awaitedTask(vm, definition, receiver) {
  const value = readValue(vm, definition, receiver);
  if (definition.kind === 'yieldAwaiter') return yieldTask(vm);
  if (value.fields[0] === null) throw new ManagedFault('NullReferenceException', 'Default TaskAwaiter has no task');
  return vm.scheduler.taskRecord(value.fields[0]);
}

function awaitCompletion(vm, definition, args) {
  const task = builderTask(vm, definition, args[0]);
  const [awaiterType, machineType] = definition.methodArguments;
  const awaiterTable = vm.typeSystem.table(awaiterType);
  const awaiterDefinition = {type: awaiterType, kind: awaiterTable.flags.asyncValue};
  if (!['awaiter', 'yieldAwaiter'].includes(awaiterDefinition.kind)) invalid('Unsupported async notification awaiter');
  const awaited = awaitedTask(vm, awaiterDefinition, args[1]);
  const stable = stableMachine(vm, task, machineType, args[2]);
  if (stable.promoted) {
    const receiver = vm.address('box', 0, stable.continuation.receiver);
    vm.call(stable.machine.setStateMachine, [receiver, stable.continuation.receiver], {
      genericIdentity: machineType.includes('<') ? machineType : null,
      asyncRegistration: Object.freeze({task: awaited.ref, continuation: stable.continuation})
    });
    return SUSPENDED;
  }
  registerAsyncContinuation(vm.scheduler, awaited, stable.continuation);
  return null;
}

function setMachine(vm, definition, args) {
  const task = builderTask(vm, definition, args[0]), receiver = args[1];
  if (receiver === null) throw new ManagedFault('ArgumentNullException', 'stateMachine');
  const record = vm.heap.get(receiver), machine = asyncStateMachine(vm.inspector, record.methodTable.name);
  if (!machine || !verifiedMethod(vm, machine.moveNext)) invalid('SetStateMachine requires an admitted managed implementation');
  const current = task.asyncMachine;
  if (current && (current.receiver.h !== receiver.h || current.receiver.g !== receiver.g)) {
    throw new ManagedFault('InvalidOperationException', 'The builder already owns another state machine');
  }
  task.asyncMachine ??= Object.freeze({kind: 'machine', type: record.methodTable.name, method: machine.moveNext, receiver});
  return null;
}

function completeBuilder(vm, definition, args) {
  const task = builderTask(vm, definition, args[0]);
  if (terminal.has(task.status)) throw new ManagedFault('InvalidOperationException', 'The task has already completed');
  if (definition.operation === 'exception') {
    const reference = args[1];
    if (reference === null) throw new ManagedFault('ArgumentNullException', 'exception');
    const record = vm.heap.get(reference);
    if (!vm.matches(reference, 'System.Exception')) invalid('SetException requires a managed exception');
    const fault = new ManagedFault(record.type, vm.format(record.data[0]), reference);
    vm.scheduler.complete(task, null, fault, vm.matches(reference, 'System.OperationCanceledException'));
  } else {
    const value = definition.element === null ? null : vm.storage(args[1], definition.element);
    vm.scheduler.complete(task, value);
  }
  task.asyncMachine = null;
  return null;
}

function getResult(vm, definition, args) {
  if (definition.kind === 'yieldAwaiter') { readValue(vm, definition, args[0]); return null; }
  const task = awaitedTask(vm, definition, args[0]);
  return vm.scheduler.wait(task.ref, {pushResult: definition.element !== null, voidResult: definition.element === null});
}

function taskOperation(vm, definition, args) {
  const scheduler = vm.scheduler;
  if (definition.operation === 'delay') {
    const milliseconds = Number(vm.value(args[0]));
    if (!Number.isInteger(milliseconds) || milliseconds < -1 || milliseconds > 2147483647) {
      throw new ManagedFault('ArgumentOutOfRangeException', 'Delay duration must be -1 or a nonnegative Int32');
    }
    const timer = milliseconds === -1 ? {} : {deadline: scheduler.now() + milliseconds, readyTurn: scheduler.turn + 1};
    const task = scheduler.createTask('void', timer);
    if (milliseconds === 0) scheduler.complete(task);
    return task.ref;
  }
  if (definition.operation === 'completedTask' || definition.operation === 'fromResult') {
    const element = definition.operation === 'fromResult' ? definition.methodArguments[0] : 'void';
    const result = element === 'void' ? null : vm.storage(args[0], element);
    const task = scheduler.createTask(element);
    vm.heap.withRoots([task.ref, result], () => scheduler.complete(task, result));
    return task.ref;
  }
  const task = scheduler.taskRecord(args[0]);
  if (definition.operation === 'getAwaiter') {
    const type = definition.element === null ? asyncTypes.awaiter : asyncTypes.awaiter + '`1<' + definition.element + '>';
    return asyncTaskValue(vm, type, task.ref);
  }
  if (definition.operation === 'status') {
    const name = definition.descriptor.name;
    return Number(name === 'get_IsCompleted' ? terminal.has(task.status)
      : task.status === (name === 'get_IsFaulted' ? 'faulted' : 'canceled'));
  }
  return scheduler.wait(task.ref, {pushResult: definition.operation === 'getTaskResult',
    voidResult: definition.operation === 'wait', failureMode: 'aggregate'});
}

const handlers = new Map([
  ['start', start], ['await', awaitCompletion], ['setMachine', setMachine],
  ['result', completeBuilder], ['exception', completeBuilder], ['getResult', getResult],
  ['create', (vm, definition) => asyncTaskValue(vm, definition.type, vm.scheduler.createTask(definition.element ?? 'void').ref)],
  ['task', (vm, definition, args) => builderTask(vm, definition, args[0]).ref],
  ['yield', vm => asyncTaskValue(vm, asyncTypes.yieldable)],
  ['yieldAwaiter', (vm, definition, args) => { readValue(vm, definition, args[0]); return asyncTaskValue(vm, asyncTypes.yieldAwaiter); }],
  ['completed', (vm, definition, args) => {
    if (definition.kind === 'yieldAwaiter') { readValue(vm, definition, args[0]); return 0; }
    return Number(terminal.has(awaitedTask(vm, definition, args[0]).status));
  }],
  ['notify', (vm, definition, args) => {
    const task = awaitedTask(vm, definition, args[0]);
    registerAsyncContinuation(vm.scheduler, task, Object.freeze({kind: 'delegate', receiver: args[1]}));
    return null;
  }]
]);

/** Execute only a proof-produced ABI definition; all user code enters ordinary verified managed frames. */
export function invokeAsync(vm, descriptor, args, definition) {
  return (handlers.get(definition.operation) ?? taskOperation)(vm, definition, args);
}
