import {RootCategory, visitRootValue, visitValues, visitExecutionRoots, visitFault} from './roots.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);

export function visitSchedulerRoots(scheduler, visitor) {
  if (!scheduler.enabled) return;
  for (const context of scheduler.contexts.values()) {
    if (terminal.has(context.status)) continue;
    const category = RootCategory.Scheduler;
    visitRootValue(context.task, visitor, category, 'task');
    visitRootValue(context.thread, visitor, category, 'thread');
    visitRootValue(context.delegate, visitor, category, 'delegate');
    visitRootValue(context.returnValue, visitor, category, 'context-return');
    visitRootValue(context.wait?.task, visitor, category, 'waiting-task');
    visitFault(context.resumeFault, visitor, category);
    if (context.id !== scheduler.currentId || scheduler.parked) visitExecutionRoots(context, visitor, category);
  }
  for (const task of scheduler.tasks.values()) {
    if (terminal.has(task.status)) continue;
    visitRootValue(task.ref, visitor, RootCategory.Scheduler, 'pending-task');
    visitValues(task.dependencies, visitor, RootCategory.Scheduler, 'dependency');
    visitFault(task.error, visitor, RootCategory.Scheduler);
  }
}

function visitAnimation(plan, visitor) {
  if (!plan) return;
  visitRootValue(plan.ref, visitor, RootCategory.Interop, 'animation');
  visitRootValue(plan.target, visitor, RootCategory.Interop, 'animation-target');
  for (const child of plan.children ?? []) visitAnimation(child, visitor);
}

export function visitPlatformRoots(platform, visitor) {
  platform.hostOperations.visitRoots(visitor);
  visitRootValue(platform.application, visitor, RootCategory.Interop, 'application');
  visitValues(platform.singletons.values(), visitor, RootCategory.Interop, 'singleton');
  visitValues(platform.windows.values(), visitor, RootCategory.Interop, 'window');
  visitValues(platform.pending, visitor, RootCategory.Interop, 'pending');
  for (const state of platform.animations.states.values()) visitAnimation(state.plan, visitor);
  for (const base of platform.animations.bases.values()) visitRootValue(base.target, visitor, RootCategory.Interop, 'animation-base');
}

export function visitHostOperationRoots(host, visitor) {
  for (const operation of host.active.values()) {
    visitRootValue(operation.task.ref, visitor, RootCategory.HostOperation, operation.id);
    visitValues(operation.roots, visitor, RootCategory.HostOperation, operation.id);
  }
}
