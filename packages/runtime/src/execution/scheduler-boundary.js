import {
  isFatalFault
} from './unhandled.js';
import {
  parkContext
} from './context-transitions.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Each logical instruction delivers terminal faults before selecting a different context. */
export function afterSchedulerInstruction(scheduler) {
  const vm = scheduler.vm;
  if (!scheduler.enabled || scheduler.suppressed) return;
  scheduler.turn++;
  scheduler.steps++;
  scheduler.save();
  if (vm.state === 'paused') return;
  const context = scheduler.current;
  if (!context) return;
  if (vm.state === 'faulted' || vm.state === 'terminated') {
    if (vm.fault && (isFatalFault(vm.fault) || !context.task &&
        !['async-state-machine', 'awaiter-continuation'].includes(context.kind))) {
      scheduler.cancelAll();
      vm.state = 'faulted';
      return;
    }
    scheduler.finish(context);
  }
  if (scheduler.flushAsyncFault()) return;
  scheduler.poll();
  if (context.status === 'waiting' && context.eagerParent) {
    scheduler.preferred = context.eagerParent;
    context.eagerParent = null;
  }
  if (context.status === 'running' && !context.frozen && scheduler.steps < scheduler.quantum && !scheduler.preferred) return;
  if (context.status === 'running') context.status = 'ready';
  const next = scheduler.choose();
  if (next) {
    scheduler.load(next);
    return;
  }
  if ([...scheduler.contexts.values()].some(item => !terminal.has(item.status))) {
    parkContext(scheduler);
    return;
  }
  const main = scheduler.contexts.get(1);
  vm.frames = [];
  if (!vm.inspector) vm.stack = [];
  vm.returnValue = main?.returnValue ?? null;
  vm.exitCode = main?.exitCode ?? 0;
  vm.fault = main?.fault ?? null;
  vm.state = main?.status === 'faulted' ? 'faulted' : 'terminated';
}

export function schedulerNextDelay(scheduler) {
  const external = scheduler.vm.platform.hostOperations?.active.size;
  let deadline = external ? 10 : Infinity;
  for (const task of scheduler.tasks.values()) {
    if (!terminal.has(task.status) && task.deadline !== undefined) {
      deadline = Math.min(deadline, Math.max(0, task.deadline - scheduler.now()));
    }
  }
  const monitor = scheduler.vm.sync?.nextDelay();
  if (monitor !== null && monitor !== undefined) deadline = Math.min(deadline, monitor);
  return deadline === Infinity ? null : deadline;
}
