import {ManagedFault} from '../heap.js';
import {boundDelegateCall} from './delegate-targets.js';
import {bindContextFrames} from './frame-lifetimes.js';
import {discardProvisionalFrames} from './frame-retirement.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);

function restoreActive(vm, previous, state, fields) {
  for (const field of fields) {
    if (field in previous) vm[field] = previous[field];
    else delete vm[field];
  }
  vm.state = state;
}

function contextName(vm, method) {
  if (!vm.inspector) return vm.image.methods[method].asyncOrigin ?? vm.image.methods[method].name;
  return vm.inspector.debug?.methods?.find(item => item.token === method)?.asyncOrigin ?? vm.top.method.name;
}

/** Publish the new context only after admission; failure retires every provisional frame. */
export function enqueueContext(scheduler, delegate, args, options, fields) {
  const {name = null, kind = 'task', task = null, parentId = scheduler.currentId, eager = false, thread = null} = options;
  const vm = scheduler.vm;
  scheduler.ensure();
  scheduler.prune();
  let live = 0;
  for (const context of scheduler.contexts.values()) if (!terminal.has(context.status)) live++;
  if (live >= scheduler.maxContexts) throw new ManagedFault('ExecutionLimitException', 'Managed context limit exceeded');
  const {method, arguments: values} = boundDelegateCall(vm, delegate, args);
  scheduler.save();
  const previous = scheduler.capture(), previousState = vm.state;
  bindContextFrames(vm, scheduler.current);
  vm.frames = [];
  if (!vm.inspector) vm.stack = [];
  vm.currentPoint = vm.pendingFault = vm.fault = vm.returnValue = null;
  vm.exitCode = 0;
  let context;
  try {
    vm.call(method, values);
    const id = scheduler.nextId;
    context = {id, name: name ?? contextName(vm, method), kind, status: 'ready', frozen: false,
      parentId, task: task?.ref ?? null, taskId: task?.id ?? null, thread, delegate, wait: null,
      eagerParent: eager ? parentId : null, ...scheduler.capture()};
    bindContextFrames(vm, context);
  } catch (error) {
    discardProvisionalFrames(vm);
    throw error;
  } finally {
    restoreActive(vm, previous, previousState, fields);
  }
  scheduler.nextId++;
  scheduler.contexts.set(context.id, context);
  if (task) task.contextId = context.id;
  if (eager) scheduler.preferred = context.id;
  if (['terminated', 'waiting'].includes(previousState) && !vm.frames.length) scheduler.load(context);
  return context.id;
}
