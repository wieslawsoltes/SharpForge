export {taskFailure} from './scheduler-task-delivery.js';

/** A live completed Task owns its original exception even after scheduler-history pruning. */
export function retainTaskFault(scheduler, task, fault) {
  if (fault?.reference) scheduler.vm.platform.set(task.ref, '$exception', fault.reference);
}
