import {scalarStorageGuard} from './scalar-storage-plan.js';
import {isReference} from '../heap.js';
import {visitRetiredFrames} from './frame-pool.js';
import {initializationRoots} from './static-init.js';
import {runtimeTypeRoots} from './tokens.js';
import {stringRoots} from './strings.js';
import {floatSlots, floatSlotRoot} from './typed-stack.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);
const borrowItems = Symbol('root iterable groups');
class RootGroup {
  constructor(items) {
    this.items = items;
  }
}

function offer(value, visit) {
  if (value === null || value === undefined) return;
  // A field/array/box address owns its containing object, not a heap record of its own.
  if (value.byref) {
    if (value.owner !== null && value.owner !== undefined) visit(value.owner);
    if (isReference(value)) visit(value);
  } else visit(value);
}

function values(items, visit) {
  if (!items) return;
  if (visit[borrowItems]) visit[borrowItems](items);
  else if (floatSlots(items)) {
    for (let index = 0; index < items.length; index++) offer(floatSlotRoot(items, index), visit);
  }
  else for (const value of items) offer(value, visit);
}

function slots(vm, frame, argument, visit, precise) {
  const items = argument ? frame.args : frame.locals;
  if (!items) return;
  if (!precise && visit[borrowItems]) {
    visit[borrowItems](items);
    return;
  }
  const method = frame.method ?? vm.image?.methods[frame.methodId];
  for (let index = 0; index < items.length; index++) {
    const value = precise ? floatSlotRoot(items, index) : items[index];
    if (precise) {
      let type;
      if (!argument) type = frame.method ? method.locals?.[index] : method?.locals?.[index]?.type;
      else if (method?.signature) {
        type = method.signature.isStatic ? method.signature.parameters[index]
          : index === 0 ? 'object' : method.signature.parameters[index - 1];
      }
      const accepts = scalarStorageGuard(type);
      // Metadata is not sufficient proof after host/debugger edits to a frame.
      if (accepts && accepts(value, vm.options) && !isReference(value) && !value?.byref) continue;
    }
    offer(value, visit);
  }
}

/** Continuations retain their values independent of declared slots or instruction position. */
export function visitFrameContinuations(frame, visit, sourceOrder = false) {
  if (!sourceOrder) {
    offer(frame.exception?.reference, visit);
    for (const caught of frame.caught ?? []) offer(caught.fault?.reference, visit);
  }
  for (const unwind of frame.unwinds ?? []) {
    offer(unwind.value, visit);
    offer(unwind.error?.reference, visit);
  }
  if (sourceOrder) {
    offer(frame.exception?.reference, visit);
    for (const caught of frame.caught ?? []) offer(caught.fault?.reference, visit);
  }
  if (frame.pending && !frame.unwinds?.includes(frame.pending)) {
    offer(frame.pending.value, visit);
    offer(frame.pending.error?.reference, visit);
  }
}

/** All evaluation-stack slots remain conservative; only canonical declared scalars are omitted. */
export function visitFrameRoots(vm, frame, visit, precise = true, parked = false) {
  if (parked) {
    slots(vm, frame, false, visit, precise);
    slots(vm, frame, true, visit, precise);
    values(frame.stack, visit);
  } else {
    values(frame.stack, visit);
    slots(vm, frame, true, visit, precise);
    slots(vm, frame, false, visit, precise);
  }
  offer(frame.returnObject, visit);
  visitFrameContinuations(frame, visit);
}

/** Shared scheduler inventory for collection and its public iterable compatibility wrapper. */
export function visitSchedulerRoots(scheduler, visit, precise = true) {
  if (!scheduler) return;
  const vm = scheduler.vm;
  for (const scope of scheduler.callbackScopes ?? []) {
    values(scope.stack, visit);
    for (const frame of scope.frames) visitFrameRoots(vm, frame, visit, precise);
  }
  if (!scheduler.enabled) return;
  for (const context of scheduler.contexts.values()) {
    if (terminal.has(context.status)) continue;
    offer(context.task, visit);
    offer(context.thread, visit);
    offer(context.delegate, visit);
    offer(context.returnValue, visit);
    offer(context.wait?.task, visit);
    offer(context.resumeFault?.reference, visit);
    if (context.id === scheduler.currentId && !scheduler.parked) continue;
    values(context.stack, visit);
    for (const frame of context.frames) visitFrameRoots(vm, frame, visit, precise, true);
    offer(context.pendingFault?.reference, visit);
    offer(context.fault?.reference, visit);
  }
  for (const task of scheduler.tasks.values()) {
    if (terminal.has(task.status)) continue;
    offer(task.ref, visit);
    values(task.dependencies, visit);
    offer(task.error?.reference, visit);
  }
}

/** One VM root inventory, consumed without generators on the frame/slot collection path. */
export function visitVMRoots(vm, visit, precise = true) {
  values(vm.platform?.roots(), visit);
  visitSchedulerRoots(vm.scheduler, visit, precise);
  if (vm.inspector) {
    values(initializationRoots(vm), visit);
    values(runtimeTypeRoots(vm), visit);
    values(vm.statics.values(), visit);
    values(stringRoots(vm), visit);
    offer(vm.returnValue, visit);
    offer(vm.fault?.reference, visit);
    offer(vm.pendingFault?.reference, visit);
    for (const frame of vm.frames) visitFrameRoots(vm, frame, visit, precise);
  } else {
    offer(vm.returnValue, visit);
    values(vm.stack, visit);
    values(vm.statics, visit);
    values(vm.constantValues.values(), visit);
    values(stringRoots(vm), visit);
    values(runtimeTypeRoots(vm), visit);
    for (const frame of vm.frames) slots(vm, frame, false, visit, precise);
    for (const frame of vm.frames) visitFrameContinuations(frame, visit, true);
    offer(vm.fault?.reference, visit);
    offer(vm.pendingFault?.reference, visit);
  }
  // Return/EH callbacks can still inspect retired frames before the instruction's flush.
  visitRetiredFrames(vm, frame => visitFrameRoots(vm, frame, visit, false));
}

/** Keep only borrowed container groups; never materialize all numeric frame slots. */
function* rootGroups(inventory) {
  const groups = [], pending = [];
  const visit = value => groups.push(value);
  visit[borrowItems] = items => groups.push(new RootGroup(items));
  inventory(visit);
  const append = value => pending.push(value);
  for (const group of groups) {
    if (!(group instanceof RootGroup)) {
      yield group;
      continue;
    }
    for (const value of group.items) {
      offer(value, append);
      for (let index = 0; index < pending.length; index++) yield pending[index];
      pending.length = 0;
    }
  }
}

/** Generic iterable wrappers share the inventory and deliberately omit scalar filtering. */
export function* rootValues(vm) {
  yield* rootGroups(visit => visitVMRoots(vm, visit, false));
}

export function* schedulerRootValues(scheduler) {
  yield* rootGroups(visit => visitSchedulerRoots(scheduler, visit, false));
}

export function* continuationRootValues(frame, sourceOrder = false) {
  yield* rootGroups(visit => visitFrameContinuations(frame, visit, sourceOrder));
}

/** Retain the no-argument iterable provider contract used by heap diagnostics. */
export function installRootProvider(vm) {
  const originalRoots = vm.roots;
  vm.heap.rootProvider = visit => {
    if (typeof visit !== 'function' || vm.options.preciseRoots === false || vm.roots !== originalRoots) return vm.roots();
    visitVMRoots(vm, visit);
  };
}
