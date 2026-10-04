import {ManagedFault} from '../heap.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);
const fields = ['frames', 'stack', 'currentPoint', 'pendingFault', 'fault', 'returnValue', 'exitCode', 'sourcePause'];

function restore(vm, previous, state) {
  for (const field of fields) if (field in previous) vm[field] = previous[field];
  vm.state = state;
}

/** Retain the scheduler's admission order before resolving any managed delegate. */
export function prepareManagedContext(scheduler) {
  scheduler.ensure();
  scheduler.prune();
  let live = 0;
  for (const context of scheduler.contexts.values()) if (!terminal.has(context.status)) live++;
  if (live >= scheduler.maxContexts) throw new ManagedFault('ExecutionLimitException', 'Managed context limit exceeded');
}

/** Shared managed call-frame admission for delegate work and verified state-machine continuations. */
export function enqueueManagedContext(scheduler, call, options = {}, prepared = false) {
  const vm = scheduler.vm;
  if (!prepared) prepareManagedContext(scheduler);
  scheduler.save();
  const previous = scheduler.capture(), previousState = vm.state;
  vm.frames = [];
  if (!vm.inspector) vm.stack = [];
  vm.currentPoint = vm.pendingFault = vm.fault = vm.returnValue = null;
  vm.exitCode = 0;
  try { vm.call(call.method, call.arguments, call.extra ?? {}); }
  catch (error) { restore(vm, previous, previousState); throw error; }
  const id = scheduler.nextId++;
  const parentId = options.parentId ?? scheduler.currentId;
  const origin = vm.inspector ? vm.inspector.debug?.methods?.find(method => method.token === call.method)?.asyncOrigin
    ?? vm.top.method.name : vm.image.methods[call.method].asyncOrigin ?? vm.image.methods[call.method].name;
  const context = {id, name: options.name ?? origin,
    kind: options.kind ?? 'task', status: 'ready', frozen: false, parentId, task: options.task?.ref ?? null,
    taskId: options.task?.id ?? null, thread: options.thread ?? null, delegate: options.delegate ?? null,
    wait: null, eagerParent: options.eager ? parentId : null, ...scheduler.capture()};
  scheduler.contexts.set(id, context);
  if (options.task) options.task.contextId = id;
  restore(vm, previous, previousState);
  if (options.eager) scheduler.preferred = id;
  if (['terminated', 'waiting'].includes(previousState) && !vm.frames.length) scheduler.load(context);
  return id;
}
