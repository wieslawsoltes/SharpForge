import {observeContextTransition} from './context-events.js';

/** Existing scheduler activation policy, followed by deferred scalar observations. */
export function loadContext(scheduler, context, fields) {
  const previous = scheduler.parked ? null : scheduler.current;
  scheduler.parked = false;
  scheduler.currentId = context.id;
  for (const field of fields) if (field in context) scheduler.vm[field] = context[field];
  scheduler.vm.state = 'running';
  context.status = 'running';
  scheduler.steps = 0;
  observeContextTransition(scheduler, previous, context);
}

/** Park only after the caller saved its context and found no runnable successor. */
export function parkContext(scheduler) {
  const previous = scheduler.parked ? null : scheduler.current;
  scheduler.parked = true;
  scheduler.vm.state = 'waiting';
  scheduler.vm.frames = [];
  if (!scheduler.vm.inspector) scheduler.vm.stack = [];
  observeContextTransition(scheduler, previous, null);
}
