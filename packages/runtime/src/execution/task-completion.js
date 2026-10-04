import {completeAsyncContinuations, visitAsyncTaskRoots} from './async-continuations.js';
import {retainTaskFault} from './task-faults.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Complete a task once, retaining detached callback data through fault creation and managed scheduling. */
export function completeTask(scheduler, task, result = null, error = null, canceled = false) {
  if (terminal.has(task.status)) return;
  const vm = scheduler.vm, roots = [task.ref, result, error?.reference];
  visitAsyncTaskRoots(task, reference => roots.push(reference));
  vm.heap.withRoots(roots, () => {
    task.result = result;
    task.error = error;
    task.status = canceled ? 'canceled' : error ? 'faulted' : 'completed';
    task.completed = scheduler.now();
    vm.platform.set(task.ref, '$status', task.status);
    vm.platform.set(task.ref, '$result', result);
    if (error) {
      retainTaskFault(scheduler, task, error);
      const message = vm.heap.string(error.name + ': ' + error.message);
      vm.heap.withRoots([message], () => vm.platform.set(task.ref, '$error', message));
    }
    for (const id of task.waiters) {
      const context = scheduler.contexts.get(id);
      if (!context?.wait || terminal.has(context.status)) continue;
      if (error || canceled) context.resumeFault = scheduler.failure(task, context.wait.failureMode);
      else if (context.wait.pushResult) {
        const value = context.wait.voidResult ? null : result;
        if (vm.inspector) context.frames.at(-1)?.stack.push(value);
        else context.stack.push(value);
      }
      context.wait = null;
      context.status = 'ready';
    }
    task.waiters.clear();
    completeAsyncContinuations(scheduler, task);
  });
}
