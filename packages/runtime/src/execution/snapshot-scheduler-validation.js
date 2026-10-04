import {isReference} from './managed-fault.js';
import {snapshotInteger as integer, invalidSnapshot as fail, snapshotPairs, snapshotFault, terminalContext}
  from './snapshot-validation-helpers.js';

/** Scheduler rows reference the same captured execution graph as active frames and faults. */
export function validateSnapshotScheduler(vm, snapshot, engine, referenceRecord) {
  const scheduler = snapshot.scheduler;
  if (scheduler === null) return;
  if (!scheduler || !integer(scheduler.currentId) || scheduler.currentId < 1 || !integer(scheduler.nextId) ||
      !integer(scheduler.nextTaskId) || !Number.isFinite(scheduler.clock) || scheduler.clock < 0 ||
      !integer(scheduler.turn) || !integer(scheduler.steps) || typeof scheduler.parked !== 'boolean' ||
      typeof scheduler.suppressed !== 'boolean') fail('scheduler');
  snapshotPairs(scheduler.contexts, 'scheduler contexts');
  snapshotPairs(scheduler.tasks, 'scheduler tasks');
  const contexts = new Map(scheduler.contexts), taskReferences = new Set();
  if (contexts.size > vm.scheduler.maxContexts || scheduler.tasks.length > vm.scheduler.maxTasks) fail('scheduler quota');
  for (const [id, context] of contexts) {
    if (!integer(id) || id < 1 || context?.id !== id || id >= scheduler.nextId || !Array.isArray(context.frames) ||
        !['ready', 'running', 'waiting', 'completed', 'faulted', 'canceled'].includes(context.status) ||
        typeof context.frozen !== 'boolean') fail('context identity or state');
    if (terminalContext(context.status) && context.frames.length) fail('terminal context retains frames');
    if (context.stack !== undefined && !Array.isArray(context.stack)) fail('context stack');
    snapshotFault(context.fault);
    snapshotFault(context.pendingFault);
    snapshotFault(context.resumeFault);
    if (context.wait !== null && context.wait !== undefined) {
      referenceRecord(context.wait.task);
      for (const flag of ['pushResult', 'voidResult', 'propagateFault']) {
        if (context.wait[flag] !== undefined && typeof context.wait[flag] !== 'boolean') fail('context wait flags');
      }
    }
  }
  const current = contexts.get(scheduler.currentId);
  if (!current) fail('current context');
  if (!scheduler.parked && !terminalContext(current.status) &&
      (current.frames !== snapshot.frames || engine === 'source' && current.stack !== snapshot.stack)) {
    fail('current context aliases');
  }
  if (scheduler.parked && (snapshot.frames.length || engine === 'source' && snapshot.stack.length)) fail('parked execution');
  for (const [id, task] of scheduler.tasks) {
    if (!integer(id) || id < 1 || id >= scheduler.nextTaskId || task?.id !== id || !Array.isArray(task.waiters) ||
        new Set(task.waiters).size !== task.waiters.length || task.waiters.some(waiter => !contexts.has(waiter)) ||
        !['waiting', 'running', 'completed', 'faulted', 'canceled'].includes(task.status) ||
        task.dependencies !== null && task.dependencies !== undefined && !Array.isArray(task.dependencies)) fail('task');
    snapshotFault(task.error);
    if (!isReference(task.ref) || !integer(task.ref.h) || !integer(task.ref.g)) fail('task reference');
    if (!terminalContext(task.status)) referenceRecord(task.ref);
    const key = task.ref.h + ':' + task.ref.g;
    if (taskReferences.has(key)) fail('duplicate task reference');
    taskReferences.add(key);
  }
  snapshotFault(scheduler.unhandledFault);
}
