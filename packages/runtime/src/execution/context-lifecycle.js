import {copyExecution} from '../snapshot.js';

/** Isolated synchronous callbacks own real frames without replacing the interrupted scheduler context. */
export function executionFrames(scheduler) {
  if (!scheduler.enabled) return scheduler.vm.frames;
  const live = context => !['completed', 'faulted', 'canceled'].includes(context.status);
  if (scheduler.suppressed) {
    const frames = new Map(scheduler.vm.frames.map(frame => [frame.id, frame]));
    for (const scope of scheduler.callbackScopes ?? []) {
      for (const frame of scope.frames) if (!frames.has(frame.id)) frames.set(frame.id, frame);
    }
    for (const context of scheduler.contexts.values()) if (live(context)) {
      for (const frame of context.frames) if (!frames.has(frame.id)) frames.set(frame.id, frame);
    }
    return [...frames.values()];
  }
  scheduler.save();
  return [...scheduler.contexts.values()].flatMap(context => live(context) ? context.frames : []);
}

/** Native external decisions are canceled on rewind; only the existing managed execution snapshot is restored. */
export function restoreContexts(scheduler, snapshot, cloneContext) {
  scheduler.completions.cancelAll('Managed execution was rewound');
  if (!snapshot) {
    scheduler.parked = false;
    scheduler.enabled = false;
    scheduler.contexts.clear();
    scheduler.tasks.clear();
    return;
  }
  scheduler.enabled = true;
  scheduler.nextId = Math.max(scheduler.nextId, snapshot.nextId);
  scheduler.nextTaskId = Math.max(scheduler.nextTaskId, snapshot.nextTaskId);
  scheduler.parked = !!snapshot.parked;
  scheduler.currentId = snapshot.currentId;
  scheduler.clock = snapshot.clock;
  scheduler.epoch = performance.now() - snapshot.clock;
  scheduler.turn = snapshot.turn;
  scheduler.steps = snapshot.steps;
  scheduler.preferred = snapshot.preferred;
  scheduler.contexts = new Map(snapshot.contexts.map(([id, context]) => [id, cloneContext(context)]));
  scheduler.tasks = new Map(snapshot.tasks.map(([id, task]) => [id, {...task, error: copyExecution(task.error),
    waiters: new Set(task.waiters), dependencies: task.dependencies ? [...task.dependencies] : null}]));
  scheduler.save();
}
