import {completeAsyncContinuations} from './async-continuations.js';
import {visitAsyncTaskRoots} from './async-continuation-roots.js';
import {ManagedFault} from './managed-fault.js';
import {createException, faultFromException} from './exception-object.js';
import {initializeAggregate} from './aggregate-exception.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Complete a task once, retaining detached callback data through fault creation and managed scheduling. */
export function completeTask(scheduler, task, result = null, error = null, canceled = false) {
  if (terminal.has(task.status)) return;
  const vm = scheduler.vm, roots = [task.ref, result, error?.reference];
  visitAsyncTaskRoots(task, reference => roots.push(reference));
  if (task.asyncState) roots.push(task.asyncState.machine, task.asyncState.awaitedTask);
  vm.heap.withRoots(roots, () => {
    task.result = result;
    task.error = error;
    task.status = canceled ? 'canceled' : error ? 'faulted' : 'completed';
    task.completed = scheduler.now();
    vm.platform.set(task.ref, '$status', task.status);
    vm.platform.set(task.ref, '$result', result);
    if (error) {
      if (error.reference) vm.platform.set(task.ref, '$exception', error.reference);
      const message = vm.heap.string(error.name + ': ' + error.message);
      vm.heap.withRoots([message], () => vm.platform.set(task.ref, '$error', message));
    }
    for (const id of task.waiters) {
      const context = scheduler.contexts.get(id);
      if (!context?.wait || terminal.has(context.status)) continue;
      if ((error || canceled) && context.wait.propagateFault !== false) context.resumeFault = scheduler.failure(task, context.wait.failureMode);
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

function originalFailure(scheduler, task) {
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

/** Wait and Result wrap failures; await's GetResult retains the original managed exception. */
export function taskFailure(scheduler, task, mode = null) {
  const fault = mode === 'aggregate' && task.status === 'canceled'
    ? new ManagedFault('System.Threading.Tasks.TaskCanceledException', 'A task was canceled.') : originalFailure(scheduler, task);
  if (mode !== 'aggregate') return fault;
  const vm = scheduler.vm;
  let inner = fault.reference;
  if (!inner) {
    const message = vm.heap.string(fault.message);
    inner = createException(vm, fault.name, message);
  }
  const text = 'One or more errors occurred. (' + fault.message + ')';
  return vm.heap.withRoots([inner], () => {
    const message = vm.heap.string(text);
    const reference = createException(vm, 'System.AggregateException', message, inner);
    initializeAggregate(vm, reference, [message, inner], {parameters: ['string', 'System.Exception']});
    return new ManagedFault('System.AggregateException', text, reference);
  });
}
