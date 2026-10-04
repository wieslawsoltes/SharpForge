import {ManagedFault} from '../heap.js';

/** A live completed Task owns the original managed exception independently of scheduler record pruning. */
export function retainTaskFault(scheduler, task, fault) {
  if (fault?.reference) scheduler.vm.platform.set(task.ref, '$exception', fault.reference);
}

function originalFailure(scheduler, task) {
  if (task.error) return task.error;
  const vm = scheduler.vm, reference = vm.platform.get(task.ref, '$exception');
  if (reference) {
    const record = vm.heap.get(reference);
    return new ManagedFault(record.type, vm.format(record.data[0]), reference);
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
    inner = vm.heap.allocate('exception', fault.name, [message], [message]);
  }
  const text = 'One or more errors occurred. (' + fault.message + ')';
  return vm.heap.withRoots([inner], () => {
    const message = vm.heap.string(text);
    const reference = vm.heap.allocate('exception', 'System.AggregateException', [message, inner], [message, inner]);
    return new ManagedFault('System.AggregateException', text, reference);
  });
}
