function contextThread(context, status = context.status) {
  return {id: context.id, name: context.name, kind: context.kind, status, frozen: context.frozen,
    parentId: context.parentId, taskId: context.taskId ?? null, waitingFor: null, frameIds: []};
}

function copyThreads(threads) {return threads.map(thread => ({...thread, frameIds: [...thread.frameIds]}));}

export function schedulerThreads(scheduler) {
  if (!scheduler.enabled) {
    if (scheduler.finishedThreads) return copyThreads(scheduler.finishedThreads);
    const {vm} = scheduler;
    return [{id: 1, name: 'Main', kind: 'main', status: vm.state === 'terminated' ? 'completed' : vm.state,
      frozen: false, parentId: null, taskId: null, frameIds: vm.frames.map(frame => frame.id)}];
  }
  scheduler.save();
  return [...scheduler.contexts.values()].map(context => ({
    ...contextThread(context, context.id === scheduler.currentId && scheduler.vm.state === 'paused' ? 'paused' : context.status),
    waitingFor: context.wait ? scheduler.vm.platform.get(context.wait.task, 'Id') : null,
    frameIds: context.frames.map(frame => frame.id)
  }));
}

/** Retain scalar thread diagnostics after cancellation while releasing all managed execution state. */
export function disposeScheduler(scheduler) {
  if (!scheduler.enabled && scheduler.finishedThreads) return;
  scheduler.finishedThreads = scheduler.enabled
    ? [...scheduler.contexts.values()].map(context => contextThread(context))
    : [{id: 1, name: 'Main', kind: 'main', status: scheduler.vm.state === 'faulted' ? 'faulted'
      : scheduler.vm.state === 'terminated' ? 'completed' : 'canceled', frozen: false, parentId: null,
      taskId: null, waitingFor: null, frameIds: []}];
  scheduler.contexts.clear();
  scheduler.tasks.clear();
  scheduler.enabled = false;
  scheduler.parked = false;
  scheduler.preferred = null;
}

export function snapshotFinishedThreads(scheduler) {
  return scheduler.finishedThreads ? {finishedThreads: copyThreads(scheduler.finishedThreads)} : null;
}

export function restoreFinishedThreads(scheduler, snapshot) {
  scheduler.finishedThreads = snapshot?.finishedThreads ? copyThreads(snapshot.finishedThreads) : null;
}
