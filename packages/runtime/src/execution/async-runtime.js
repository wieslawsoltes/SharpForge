import {
  asyncMethodDefinition,
  asyncStateMachine,
  asyncTypeDefinition,
  genericTypeParts,
  normalizeCallType
} from '@sharpforge/cil';
import {
  ManagedFault,
  isReference
} from '../heap.js';
import {
  SUSPENDED
} from '../platform.js';
import {
  address,
  validatePointer,
  pointerType
} from './control-pointers.js';
import {
  createValueFromFields,
  isValueRecord
} from './value-types.js';
import {
  boxValue
} from './boxing.js';
import {registerAsyncContinuation} from './async-continuations.js';
import {invokeAsyncTaskOperation} from './async-task-operations.js';
const createValue = (vm, type, fields) => createValueFromFields(vm, vm.typeSystem.table(type), fields);

export {
  asyncTypeDefinition
};
const C = 'System.Runtime.CompilerServices.',
  terminal = new Set(['completed', 'faulted', 'canceled']);
const invalid = message => new ManagedFault('InvalidProgramException', message);
const sameRef = (a, b) => a && b && a.h === b.h && a.g === b.g;

function recordValue(vm, receiver, owner, {
  write = false
} = {}) {
  if (receiver?.byref) {
    validatePointer(vm, receiver, {
      write
    });
    receiver = vm.dereference(receiver);
  }
  const table = vm.typeSystem.table(owner);
  if (!isValueRecord(receiver) || receiver.valueType !== table || receiver.fields.length !== 1) throw invalid(
    'Async infrastructure receiver has the wrong value type');
  return receiver;
}

function builder(vm, receiver, definition, materialize = true) {
  if (!receiver?.byref) throw invalid('An async builder requires an addressable receiver');
  const value = recordValue(vm, receiver, definition.owner, {
    write: true
  });
  let reference = value.fields[0];
  if (!reference && !materialize) return null;
  if (!reference) {
    const state = {
      kind: definition.owner.endsWith('AsyncVoidMethodBuilder') ? 'void' : 'task',
      builderType: value.valueType.name,
      machine: null,
      moveNext: null,
      contextId: null,
      awaitedTask: null,
      phase: 'created'
    };
    const task = vm.scheduler.createTask(definition.resultType, {
      asyncState: state
    });
    reference = task.ref;
    vm.heap.withRoots([reference], () => vm.dereference(receiver, true, createValue(vm, value.valueType, [reference])));
  }
  const task = vm.scheduler.taskRecord(reference);
  if (!task.asyncState || task.asyncState.builderType !== value.valueType.name) throw invalid('Builder task identity is invalid');
  return task;
}

function awaiter(vm, receiver, definition) {
  const value = recordValue(vm, receiver, definition.owner),
    reference = value.fields[0],
    yielding = definition.owner.endsWith('YieldAwaitable+YieldAwaiter');
  if (!reference && yielding) return {
    task: null,
    yielding
  };
  if (!reference) throw new ManagedFault('NullReferenceException', 'TaskAwaiter has no task');
  const task = vm.scheduler.taskRecord(reference);
  if (!yielding && normalizeCallType(task.resultType) !== normalizeCallType(definition.resultType)) throw invalid(
    'TaskAwaiter result type does not match its task');
  return {
    task,
    yielding
  };
}

function machineInfo(vm, pointer, expected) {
  validatePointer(vm, pointer);
  const type = pointerType(vm, pointer),
    expectedType = vm.typeSystem.table(expected),
    value = vm.dereference(pointer);
  if (type !== expectedType) throw invalid('State-machine argument type mismatch');
  if (value === null) throw new ManagedFault('ArgumentNullException', 'stateMachine');
  const table = isReference(value) ? vm.heap.get(value).methodTable : type,
    iface = vm.typeSystem.table(C + 'IAsyncStateMachine');
  if (!vm.typeSystem.castCache.isAssignableFrom(iface, table)) throw invalid('State machine must implement IAsyncStateMachine');
  const machine = asyncStateMachine(vm.inspector, table.name);
  const token = machine?.moveNext;
  if (!token || !vm.report.methods.includes(token) || !vm.report.methods.includes(machine.setStateMachine)) {
    throw invalid('State-machine callbacks must be verified');
  }
  return {
    table,
    value,
    token,
    receiver: table.flags.valueType ? pointer : value,
    genericIdentity: table.typeArguments.length ? table.name : null
  };
}

function ensureBox(vm, task, info) {
  const state = task.asyncState;
  if (state.machine) {
    if (info.table.flags.valueType) {
      if (info.receiver.kind !== 'box' || info.receiver.path.length || !sameRef(info.receiver.owner, state.machine)) throw invalid(
        'A suspended state machine cannot be replaced');
    } else if (!sameRef(info.value, state.machine)) throw invalid('A suspended state machine cannot be replaced');
    return state.machine;
  }
  const machine = info.table.flags.valueType ? boxValue(vm, info.value, info.table) : info.value;
  state.machine = machine;
  state.moveNext = info.token;
  return machine;
}

function rejectCycle(vm, task, awaited) {
  const seen = new Set();
  let next = awaited;
  while (next && !seen.has(next.id)) {
    if (next.id === task.id) throw new ManagedFault('InvalidOperationException', 'Async state machine cannot await its own result');
    seen.add(next.id);
    const wait = vm.scheduler.contexts.get(next.contextId)?.wait;
    next = wait ? vm.scheduler.taskRecord(wait.task) : null;
  }
}

function scheduleMachine(vm, task, awaiterPointer, machinePointer, definition) {
  if (vm.scheduler.suppressed) throw new ManagedFault('InvalidOperationException', 'Async suspension is unavailable during synchronous evaluation');
  const state = task.asyncState;
  if (terminal.has(task.status)) throw new ManagedFault('InvalidOperationException', 'Async builder has already completed');
  const awaiterType = pointerType(vm, awaiterPointer),
    expected = vm.typeSystem.table(definition.methodArguments[0]);
  if (awaiterType !== expected) throw invalid('Awaiter argument type mismatch');
  const awaitDefinition = asyncMethodDefinition({
    kind: 'method',
    owner: awaiterType.name,
    name: 'GetResult',
    signature: {
      isStatic: false,
      returnType: genericTypeParts(awaiterType.name).arguments[0] ?? 'void',
      parameters: []
    }
  });
  if (!awaitDefinition) throw new ManagedFault('NotSupportedException', 'Only TaskAwaiter and YieldAwaiter state-machine suspension is supported');
  const awaited = awaiter(vm, awaiterPointer, awaitDefinition).task ?? yieldingTask(vm);
  rejectCycle(vm, task, awaited);
  const info = machineInfo(vm, machinePointer, definition.methodArguments[1]),
    machine = ensureBox(vm, task, info);
  const receiver = info.table.flags.valueType ? address(vm, 'box', 0, machine, {
    type: info.table
  }) : machine;
  return vm.heap.withRoots([task.ref, awaited.ref, machine], () => {
    const contextId = vm.scheduler.enqueueCall(info.token, [receiver], {
      name: info.table.name + '.MoveNext',
      kind: 'async-state-machine',
      waitTask: awaited.ref,
      propagateFault: false,
      extra: {
        genericIdentity: info.genericIdentity,
        asyncBuilderTask: task.ref
      }
    });
    state.phase = 'awaiting';
    state.awaitedTask = awaited.ref;
    state.contextId = contextId;
    task.contextId = contextId;
    return null;
  });
}

function managedException(vm, reference) {
  if (reference === null) throw new ManagedFault('ArgumentNullException', 'exception');
  const record = vm.heap.get(reference);
  if (!vm.matches(reference, 'System.Exception')) throw invalid('SetException requires a managed exception');
  return new ManagedFault(record.type, vm.format(record.data[0]), reference);
}

function finishBuilder(vm, task, result, error = null) {
  if (terminal.has(task.status)) throw new ManagedFault('InvalidOperationException', 'Async builder has already completed');
  const state = task.asyncState;
  if (error) vm.platform.set(task.ref, '$exception', error.reference);
  vm.scheduler.complete(task, result, error, !!error?.reference && vm.matches(error.reference, 'System.OperationCanceledException'));
  state.phase = error ? 'faulted' : 'completed';
  state.machine = null;
  state.awaitedTask = null;
  state.contextId = null;
  if (error && state.kind === 'void') vm.scheduler.postAsyncFault(error);
}

function yieldingTask(vm) {
  return vm.scheduler.createTask('void', {
    deadline: vm.scheduler.now(),
    readyTurn: vm.scheduler.turn + 1,
    forceYield: true
  });
}

/** Builder/awaiter hooks execute real MoveNext IL; scheduler state contains no closures. */
export function invokeAsyncIntrinsic(vm, descriptor, args) {
  const definition = asyncMethodDefinition(descriptor);
  if (!definition) return {
    handled: false
  };
  const parameters = definition.signature.parameters,
    expected = parameters.length + (definition.signature.isStatic ? 0 : 1);
  if (args.length !== expected) throw invalid('Async infrastructure argument count mismatch');
  let value = null;
  switch (definition.runtimeOperation) {
    case 'builder-create':
      value = createValue(vm, definition.owner, [null]);
      break;
    case 'builder-task':
      value = builder(vm, args[0], definition).ref;
      break;
    case 'builder-start': {
      const task = builder(vm, args[0], definition),
        state = task.asyncState;
      if (state.phase !== 'created') throw new ManagedFault('InvalidOperationException', 'Async builder has already started');
      const info = machineInfo(vm, args[1], definition.methodArguments[0]);
      state.phase = 'running';
      state.moveNext = info.token;
      vm.call(info.token, [info.receiver], {
        genericIdentity: info.genericIdentity,
        asyncBuilderTask: task.ref
      });
      value = SUSPENDED;
      break;
    }
    case 'builder-set-state-machine': {
      if (args[1] === null) throw new ManagedFault('ArgumentNullException', 'stateMachine');
      if (!vm.matches(args[1], C + 'IAsyncStateMachine')) throw invalid('State machine must implement IAsyncStateMachine');
      if (builder(vm, args[0], definition, false)) throw new ManagedFault('InvalidOperationException', 'Builder task was already initialized');
      break; // .NET 10 retains this legacy validation hook without storing the box.
    }
    case 'builder-await':
      value = scheduleMachine(vm, builder(vm, args[0], definition), args[1], args[2], definition);
      break;
    case 'builder-set-result': {
      const task = builder(vm, args[0], definition),
        result = definition.resultType === 'void' ? null : vm.storage(args[1], definition.resultType);
      finishBuilder(vm, task, result);
      break;
    }
    case 'builder-set-exception': {
      const error = managedException(vm, args[1]);
      finishBuilder(vm, builder(vm, args[0], definition), null, error);
      break;
    }
    case 'task-awaiter': {
      if (args[0] === null) throw new ManagedFault('NullReferenceException', 'Task is null');
      const task = vm.scheduler.taskRecord(args[0]);
      if (normalizeCallType(task.resultType) !== normalizeCallType(definition.resultType)) throw invalid('Task result type mismatch');
      value = createValue(vm, definition.signature.returnType, [args[0]]);
      break;
    }
    case 'task-yield':
      value = createValue(vm, C + 'YieldAwaitable', [null]);
      break;
    case 'yield-awaiter': {
      recordValue(vm, args[0], definition.owner);
      value = createValue(vm, definition.signature.returnType, [null]);
      break;
    }
    case 'awaiter-completed': {
      const info = awaiter(vm, args[0], definition);
      value = !info.yielding && terminal.has(info.task.status) ? 1 : 0;
      break;
    }
    case 'awaiter-result': {
      const {
        task
      } = awaiter(vm, args[0], definition), parent = vm.top?.asyncBuilderTask;
      if (parent) {
        const builderTask = vm.scheduler.taskRecord(parent);
        if (builderTask.asyncState) {
          builderTask.asyncState.phase = 'running';
          builderTask.asyncState.awaitedTask = null;
        }
      }
      value = task ? vm.scheduler.wait(task.ref, {
        pushResult: definition.resultType !== 'void',
        voidResult: definition.resultType === 'void'
      }) : null;
      break;
    }
    case 'awaiter-continuation': {
      const info = awaiter(vm, args[0], definition);
      if (args[1] === null) throw new ManagedFault('ArgumentNullException', 'continuation');
      const task = info.task ?? yieldingTask(vm);
      registerAsyncContinuation(vm.scheduler, task, Object.freeze({kind: 'delegate', receiver: args[1]}));
      break;
    }
    case 'logical-thread-id':
      value = vm.scheduler.currentId;
      break;
    default:
      value = invokeAsyncTaskOperation(vm, definition, args);
  }
  return {
    handled: true,
    value,
    returns: definition.signature.returnType !== 'void'
  };
}

/** Pending task records own boxed machines; completed task heap records own faults. */
export function* asyncRoots(vm) {
  for (const task of vm.scheduler?.tasks?.values() ?? [])
    if (task.asyncState && !terminal.has(task.status)) {
      yield task.ref;
      yield task.asyncState.machine;
      yield task.asyncState.awaitedTask;
    }
}
