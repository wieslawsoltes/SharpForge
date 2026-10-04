import {
  taskResult
} from '@sharpforge/framework';

/** A hidden task roots async-void execution; its escaped fault is posted when the context finishes. */
export function startAsyncContext(scheduler, descriptor, delegate) {
  const isVoid = descriptor.kind === 'startAsyncVoid';
  const isAsync = descriptor.owner === 'SharpForge.Runtime.Async';
  const task = scheduler.createTask(isVoid ? 'void' : taskResult(descriptor.result));
  scheduler.vm.heap.withRoots([task.ref], () => scheduler.enqueue(delegate, [], {
    kind: isVoid ? 'async-void' : isAsync ? 'async' : 'task',
    task,
    eager: isAsync && !scheduler.suppressed,
  }));
  return isVoid ? null : task.ref;
}
