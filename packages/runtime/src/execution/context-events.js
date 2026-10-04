import {RuntimeEventName} from './runtime-events.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);
// Contexts are weakly held: observations cannot retain parked guest stacks.
const suspended = new WeakMap();

/** Record committed scheduler transitions; a queued context's first activation is not a resume. */
export function observeContextTransition(scheduler, previous, next) {
  const vm = scheduler.vm;
  const log = vm.inspector ? vm.runtimeEvents : null;
  if (!log || previous === next) return;
  let observed = suspended.get(scheduler);
  if (previous?.frames.length && !terminal.has(previous.status) && !observed?.has(previous)) {
    log.emit(RuntimeEventName.Suspend,
      {context: previous.id, frame: previous.frames.at(-1).id}, vm.instructions);
    if (!observed) suspended.set(scheduler, observed = new WeakSet());
    observed.add(previous);
  }
  if (next && observed?.delete(next)) {
    log.emit(RuntimeEventName.Resume,
      {context: next.id, frame: next.frames.at(-1)?.id ?? null}, vm.instructions);
  }
}

/** Completion removes one observation; cancellation and restore establish a fresh host baseline. */
export function forgetContextSuspension(scheduler, context = null) {
  if (context) suspended.get(scheduler)?.delete(context);
  else suspended.delete(scheduler);
}
