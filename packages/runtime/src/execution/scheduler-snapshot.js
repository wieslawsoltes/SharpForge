import {copyExecution, copyFrames} from './execution-copy.js';
import {forgetContextSuspension} from './context-events.js';
import {terminalContext} from './snapshot-validation-helpers.js';

function copyContext(context, memo) {
  if (memo.has(context)) return memo.get(context);
  const copy = {};
  memo.set(context, copy);
  // Frames must enter the memo first: method bodies and offset maps are code.
  copy.frames = copyFrames(context.frames, memo);
  for (const [key, value] of Object.entries(context)) {
    if (key !== 'frames') copy[key] = copyExecution(value, memo);
  }
  return copy;
}

/** Copy all contexts and task continuations through the VM snapshot's shared memo. */
export function copySchedulerSnapshot(snapshot, memo = new Map()) {
  if (snapshot === null) return null;
  if (memo.has(snapshot)) return memo.get(snapshot);
  const copy = {};
  memo.set(snapshot, copy);
  copy.contexts = snapshot.contexts.map(([id, context]) => [id, copyContext(context, memo)]);
  for (const [key, value] of Object.entries(snapshot)) {
    if (key !== 'contexts') copy[key] = copyExecution(value, memo);
  }
  return copy;
}

/** Capture active/current frame aliases before copying parked contexts or task faults. */
export function snapshotSchedulerState(scheduler, memo = new Map()) {
  if (!scheduler.enabled) return null;
  if (!terminalContext(scheduler.current?.status)) scheduler.save();
  const snapshot = {
    parked: scheduler.parked, suppressed: scheduler.suppressed,
    currentId: scheduler.currentId, nextId: scheduler.nextId, nextTaskId: scheduler.nextTaskId,
    clock: scheduler.now(), turn: scheduler.turn, steps: scheduler.steps, preferred: scheduler.preferred,
    contexts: [...scheduler.contexts], tasks: [...scheduler.tasks].map(([id, task]) => [id, {...task, waiters: [...task.waiters]}])
  };
  if (Object.hasOwn(scheduler, 'unhandledFault')) snapshot.unhandledFault = scheduler.unhandledFault;
  return copySchedulerSnapshot(snapshot, memo);
}

/** Internal commit seam: caller has validated and detached every VM component. */
export function restoreSchedulerState(scheduler, snapshot) {
  forgetContextSuspension(scheduler);
  if (snapshot === null) {
    scheduler.parked = false;
    scheduler.enabled = false;
    scheduler.suppressed = false;
    scheduler.contexts = new Map();
    scheduler.tasks = new Map();
    delete scheduler.unhandledFault;
    return;
  }
  const contexts = new Map(snapshot.contexts);
  const tasks = new Map(snapshot.tasks.map(([id, task]) => [id, {...task, waiters: new Set(task.waiters)}]));
  scheduler.enabled = true;
  scheduler.nextId = Math.max(scheduler.nextId, snapshot.nextId);
  scheduler.nextTaskId = Math.max(scheduler.nextTaskId, snapshot.nextTaskId);
  scheduler.parked = snapshot.parked;
  scheduler.suppressed = snapshot.suppressed;
  scheduler.currentId = snapshot.currentId;
  scheduler.clock = snapshot.clock;
  scheduler.epoch = performance.now() - snapshot.clock;
  scheduler.turn = snapshot.turn;
  scheduler.steps = snapshot.steps;
  scheduler.preferred = snapshot.preferred;
  scheduler.contexts = contexts;
  scheduler.tasks = tasks;
  if (Object.hasOwn(snapshot, 'unhandledFault')) scheduler.unhandledFault = snapshot.unhandledFault;
  else delete scheduler.unhandledFault;
}
