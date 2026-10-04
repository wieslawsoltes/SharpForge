import {
  ManagedFault
} from '../heap.js';
import {
  faultFromException
} from './exception-object.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Result and exception heap properties outlive the scheduler's optional historical task row. */
export function completeTask(scheduler, task, result = null, error = null, canceled = false) {
  if (terminal.has(task.status)) return;
  const vm = scheduler.vm;
  task.result = result;
  task.error = error;
  task.status = canceled ? 'canceled' : error ? 'faulted' : 'completed';
  task.completed = scheduler.now();
  vm.heap.withRoots([task.ref, result, error?.reference], () => {
    vm.platform.set(task.ref, '$status', task.status);
    vm.platform.set(task.ref, '$result', result);
    if (error) {
      if (error.reference) vm.platform.set(task.ref, '$exception', error.reference);
      const message = vm.heap.string(error.name + ': ' + error.message);
      vm.heap.withRoots([message], () => vm.platform.set(task.ref, '$error', message));
    }
  });
  for (const id of task.waiters) {
    const context = scheduler.contexts.get(id);
    if (!context?.wait || terminal.has(context.status)) continue;
    if ((error || canceled) && context.wait.propagateFault !== false) {
      context.resumeFault = error ?? new ManagedFault('TaskCanceledException', 'Task was canceled');
    } else if (context.wait.pushResult) {
      const value = context.wait.voidResult ? null : result;
      if (vm.inspector) context.frames.at(-1)?.stack.push(value);
      else context.stack.push(value);
    }
    context.wait = null;
    context.status = 'ready';
  }
  task.waiters.clear();
}

export function taskFailure(scheduler, task) {
  if (task.error) return task.error;
  const vm = scheduler.vm,
    reference = vm.platform.get(task.ref, '$exception');
  if (reference) {
    const fault = faultFromException(vm, reference);
    fault.preserveExceptionTrace = true;
    return fault;
  }
  return new ManagedFault(task.status === 'canceled' ? 'TaskCanceledException' : 'Exception',
    vm.platform.native(vm.platform.get(task.ref, '$error')) ?? 'Task failed');
}
