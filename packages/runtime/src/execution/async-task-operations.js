import {ManagedFault} from './managed-fault.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Exact Task operations share the canonical scheduler; await keeps its separate unwrapped fault mode. */
export function invokeAsyncTaskOperation(vm, definition, args) {
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
  if (!['status', 'wait', 'getTaskResult'].includes(definition.operation)) {
    throw new ManagedFault('InvalidProgramException', 'Unknown async Task operation');
  }
  const task = scheduler.taskRecord(args[0]);
  if (definition.operation === 'status') {
    const name = definition.descriptor.name;
    return Number(name === 'get_IsCompleted' ? terminal.has(task.status)
      : task.status === (name === 'get_IsFaulted' ? 'faulted' : 'canceled'));
  }
  return scheduler.wait(task.ref, {pushResult: definition.operation === 'getTaskResult',
    voidResult: definition.operation === 'wait', failureMode: 'aggregate'});
}
