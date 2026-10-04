/** The first escaped async-void fault owns the pending process notification. */
export function postAsyncFault(scheduler, error) {
  scheduler.unhandledFault ??= error;
}

/** Inspect retained frames and complete their tasks before context storage is retired. */
export function finishControlContext(scheduler, context) {
  const vm = scheduler.vm;
  if (context.fault && context.kind === 'async-void') postAsyncFault(scheduler, context.fault);
  if (context.fault && context.kind === 'async-state-machine') {
    const reference = context.frames.find(frame => frame.asyncBuilderTask)?.asyncBuilderTask;
    if (reference) {
      const task = scheduler.taskRecord(reference);
      scheduler.complete(task, null, context.fault);
      if (task.asyncState?.kind === 'void') postAsyncFault(scheduler, context.fault);
    }
  }
  vm.sync?.cancelContext(context.id);
}
