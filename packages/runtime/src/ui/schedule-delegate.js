import {ManagedFault} from '../heap.js';
import {managedDelegateTarget} from './delegate-target.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Create the same cooperative context for lowered source delegates and native CLI delegate records. */
export function enqueueManagedDelegate(scheduler, delegate, args = [], options = {}) {
  const {vm} = scheduler;
  const target = managedDelegateTarget(vm, delegate, args);
  if (target.native) {
    return vm.platform.ui.work.enqueue(() => vm.platform.ui.bindingServices.events.invokeDelegate(delegate, args), [delegate, ...args]);
  }
  const {name = null, kind = 'task', task = null, parentId = scheduler.currentId, eager = false, thread = null} = options;
  scheduler.ensure();
  const parent = scheduler.contexts.get(parentId);
  const dispatcherThread = kind === 'ui' || kind === 'async'
    && (parentId === 1 || parent?.kind === 'ui' || parent?.dispatcherThread === 'ui' || vm.platform.ui?.work?.uiDepth > 0) ? 'ui' : null;
  scheduler.prune();
  const live = [...scheduler.contexts.values()].filter(context => !terminal.has(context.status));
  if (live.length >= scheduler.maxContexts) throw new ManagedFault('ExecutionLimitException', 'Managed context limit exceeded');
  if (!scheduler.suppressed) scheduler.save();
  const previous = scheduler.capture(), previousState = vm.state;
  let context;
  try {
    vm.frames = [];
    if (!vm.inspector) vm.stack = [];
    vm.currentPoint = null;
    vm.pendingFault = null;
    vm.fault = null;
    vm.returnValue = null;
    vm.exitCode = 0;
    vm.call(target.method, target.values);
    const id = scheduler.nextId++;
    context = {id, name: name ?? target.name, kind, status: 'ready', frozen: false, parentId, dispatcherThread,
      task: task?.ref ?? null, taskId: task?.id ?? null, thread, delegate, wait: null,
      eagerParent: eager ? parentId : null, ...scheduler.capture()};
    scheduler.contexts.set(id, context);
    if (task) task.contextId = id;
  } finally {
    Object.assign(vm, previous);
    vm.state = previousState;
  }
  if (eager) scheduler.preferred = context.id;
  if (['terminated', 'waiting'].includes(previousState) && !vm.frames.length) scheduler.load(context);
  return context.id;
}

export function callManagedDelegate(scheduler, delegate, args, suspended) {
  const target = managedDelegateTarget(scheduler.vm, delegate, args);
  if (target.native) return scheduler.vm.platform.ui.bindingServices.events.invokeDelegate(delegate, args).value;
  scheduler.vm.call(target.method, target.values);
  return suspended;
}
