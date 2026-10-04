import {ManagedFault} from '../heap.js';
import {delegateInvocation, nextDelegateCall} from './delegate-invocations.js';
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
  const {name = null, kind = 'task', task = null, parentId = scheduler.currentId, eager = false, thread = null,
    methodToken = null, extra = {}, waitTask = null, propagateFault = true} = options;
  const vm = scheduler.vm;
  scheduler.ensure();
  scheduler.prune();
  let live = 0;
  for (const context of scheduler.contexts.values()) if (!terminal.has(context.status)) live++;
  if (live >= scheduler.maxContexts) throw new ManagedFault('ExecutionLimitException', 'Managed context limit exceeded');
  const invocation = methodToken === null ? nextDelegateCall(vm, delegateInvocation(vm, delegate, args)) :
    {method: methodToken, arguments: args, extra};
  const {method, arguments: values} = invocation;
  const dependency = waitTask ? scheduler.taskRecord(waitTask) : null;
  scheduler.save();
  const previous = scheduler.capture(), previousState = vm.state, previousId = scheduler.currentId;
  bindContextFrames(vm, scheduler.current);
  vm.frames = [];
  if (!vm.inspector) vm.stack = [];
  vm.currentPoint = vm.pendingFault = vm.fault = vm.returnValue = null;
  vm.exitCode = 0;
  let context;
  scheduler.currentId = scheduler.nextId;
  try {
    vm.heap.withRoots([delegate, ...args, waitTask, task?.ref, ...values], () => vm.call(method, values, invocation.extra));
    const id = scheduler.nextId;
    context = {id, name: name ?? contextName(vm, method), kind, status: 'ready', frozen: false,
      parentId, task: task?.ref ?? null, taskId: task?.id ?? null, thread, delegate, wait: null,
      eagerParent: eager ? parentId : null, ...scheduler.capture()};
    bindContextFrames(vm, context);
    if (dependency && !terminal.has(dependency.status)) {
      context.wait = {task: waitTask, pushResult: false, voidResult: true, propagateFault};
      context.status = 'waiting';
      dependency.waiters.add(id);
    } else if (dependency && dependency.status !== 'completed' && propagateFault) context.resumeFault = scheduler.failure(dependency);
  } catch (error) {
    dependency?.waiters.delete(scheduler.nextId);
    discardProvisionalFrames(vm);
    throw error;
  } finally {
    scheduler.currentId = previousId;
    restoreActive(vm, previous, previousState, fields);
  }
  scheduler.nextId++;
  scheduler.contexts.set(context.id, context);
  if (task) task.contextId = context.id;
  if (eager && context.status === 'ready') scheduler.preferred = context.id;
  if (['terminated', 'waiting'].includes(previousState) && !vm.frames.length && context.status === 'ready') scheduler.load(context);
  return context.id;
}
