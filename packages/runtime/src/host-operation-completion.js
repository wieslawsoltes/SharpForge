import {ManagedFault} from './heap.js';

/** Complete only the still-active operation, keeping conversion and observer failures separate. */
export function createHostOperationCompletion(host, operation, convert, roots, vm) {
  const {id, task, controller, tag} = operation;
  return (value, error) => {
    if (host.active.get(id) !== operation) return;
    host.active.delete(id);
    host.revision++;
    task.external = false;
    try {
      host.p.heap.withRoots([task.ref, ...roots], () => {
        if (error) {
          const canceled = controller.signal.aborted || error.name === 'AbortError';
          const fault = error instanceof ManagedFault ? error : new ManagedFault(
            canceled ? 'TaskCanceledException' : tag === 'compute' ? 'InvalidOperationException' : 'HttpRequestException',
            error.message ?? String(error));
          vm.scheduler.complete(task, null, fault, canceled);
        } else {
          vm.scheduler.complete(task, convert(value));
        }
      });
    } catch (error) {
      vm.scheduler.complete(task, null, error instanceof ManagedFault ? error : new ManagedFault('RuntimeException', error.message));
    }
    try {
      host.p.options.onExternalComplete?.();
    } catch (callbackError) {
      host.p.lastExternalObserverError = String(callbackError.message ?? callbackError);
    }
  };
}
