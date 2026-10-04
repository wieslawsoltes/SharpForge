import {ManagedFault} from '../heap.js';

const indexes = new WeakMap();
const terminal = new Set(['completed', 'faulted', 'canceled']);
const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };
const emptyIndex = () => ({frames: new Map(), containers: new WeakMap(), records: new WeakMap()});

function containerFor(index, frames) {
  let container = index.containers.get(frames);
  if (!container) {
    container = {frames, context: null, callback: null};
    index.containers.set(frames, container);
  }
  return container;
}

function add(index, container, position) {
  const frame = container.frames[position];
  if (!Number.isSafeInteger(frame?.id) || frame.id < 1) invalid('Invalid live frame identity');
  const previous = index.frames.get(frame.id);
  if (previous) {
    if (previous.frame !== frame || previous.container !== container || previous.position !== position) {
      invalid('Duplicate live frame identity');
    }
    return;
  }
  let entry = index.records.get(frame);
  if (!entry) {
    entry = {frame, container: null, position: -1};
    index.records.set(frame, entry);
  }
  entry.container = container;
  entry.position = position;
  index.frames.set(frame.id, entry);
}

function addFrames(index, frames, context = null) {
  if (!Array.isArray(frames)) invalid('Invalid live frame list');
  const container = containerFor(index, frames);
  if (context) container.context = context;
  for (let position = 0; position < frames.length; position++) {
    if (index.frames.has(frames[position]?.id)) invalid('Duplicate live frame identity');
    add(index, container, position);
  }
}

function collect(frames, scheduler) {
  const index = emptyIndex();
  addFrames(index, frames);
  for (const scope of scheduler?.callbackScopes ?? []) {
    if (scope.canceled) continue;
    if (scope.frames !== frames) addFrames(index, scope.frames);
    const container = containerFor(index, scope.frames);
    if (container.callback) invalid('Duplicate live callback frame scope');
    container.callback = scope;
  }
  if (scheduler?.enabled === false) return index;
  for (const [id, context] of scheduler?.contexts ?? []) {
    if (terminal.has(context.status)) continue;
    // During provisional enqueue the saved parent and vm.frames are distinct.
    if (id === scheduler.currentId && !scheduler.parked && index.containers.has(context.frames)) {
      containerFor(index, context.frames).context = context;
      continue;
    }
    addFrames(index, context.frames, context);
  }
  return index;
}

/** Rebuild derived identities after complete restore; fatal active frames remain inspectable. */
export function rebuildFrameIndex(vm) {
  const index = collect(vm.frames, vm.scheduler);
  indexes.set(vm, index);
  return index.frames;
}

function indexFor(vm) {
  if (!indexes.has(vm)) rebuildFrameIndex(vm);
  return indexes.get(vm);
}

/** Issue VM-local identities monotonically, including failed provisional calls. */
export function nextFrameId(vm) {
  if (!Number.isSafeInteger(vm.frameId) || vm.frameId < 0) invalid('Invalid managed frame sequence');
  if (vm.frameId === Number.MAX_SAFE_INTEGER) {
    throw new ManagedFault('ExecutionLimitException', 'Managed frame identity sequence exhausted');
  }
  return ++vm.frameId;
}

/** Register an appended, fully constructed frame. Lookup never searches frame arrays. */
export function registerFrame(vm, frame) {
  const position = vm.frames.length - 1;
  if (vm.frames[position] !== frame) invalid('Only an appended frame can be admitted');
  const index = indexFor(vm);
  add(index, containerFor(index, vm.frames), position);
}

/** Bind saved storage without walking its frames; context switches preserve address lifetime. */
export function bindContextFrames(vm, context) {
  const index = indexes.get(vm);
  if (index) containerFor(index, context.frames).context = context;
}

/** Retained synchronous callers stay live without scanning callback scopes on address lookup. */
export function bindCallbackFrames(vm, scope) {
  const index = indexes.get(vm);
  if (!index) return;
  const container = containerFor(index, scope.frames);
  if (container.callback && container.callback !== scope) invalid('Duplicate live callback frame scope');
  container.callback = scope;
}

export function releaseCallbackFrames(vm, scope) {
  const container = indexes.get(vm)?.containers.get(scope.frames);
  if (container?.callback === scope) container.callback = null;
}

/** End address lifetime before deferred pool clearing can recycle the frame object. */
export function releaseFrame(vm, frame) {
  const index = indexes.get(vm);
  const entry = index?.frames.get(frame.id);
  if (entry?.frame !== frame) return;
  index.frames.delete(frame.id);
  entry.container = null;
  entry.position = -1;
}

export function clearFrameIndex(vm) {
  indexes.set(vm, emptyIndex());
}

function liveContainer(vm, container) {
  if (container.frames === vm.frames) return true;
  const scope = container.callback;
  if (scope && !scope.canceled && scope.frames === container.frames) return true;
  const scheduler = vm.scheduler, context = container.context;
  return scheduler?.enabled && context && !terminal.has(context.status) &&
    scheduler.contexts.get(context.id) === context && context.frames === container.frames;
}

/** O(1), including membership guards. The identity index is never a managed GC root provider. */
export function frameById(vm, id) {
  const entry = indexFor(vm).frames.get(id);
  if (!entry || entry.frame.id !== id || entry.container.frames[entry.position] !== entry.frame ||
      !liveContainer(vm, entry.container)) invalid('Managed address outlived its frame');
  return entry.frame;
}

/** Reject conflicting captured identities before touching live frames, pools or the index. */
export function validateFrameIndexSnapshot(snapshot) {
  const frames = snapshot.frames, scheduler = snapshot.scheduler;
  if (!Number.isSafeInteger(snapshot.frameId) || snapshot.frameId < 0) invalid('Invalid captured frame sequence');
  const index = emptyIndex();
  addFrames(index, frames);
  const contexts = new Set();
  for (const [id, context] of scheduler?.contexts ?? []) {
    if (!Number.isSafeInteger(id) || id < 1 || context?.id !== id || contexts.has(id)) {
      invalid('Invalid captured context identity');
    }
    contexts.add(id);
    if (!Array.isArray(context.frames)) invalid('Invalid captured context frames');
    if (terminal.has(context.status)) {
      if (context.frames.length) invalid('Terminal context retains captured frames');
      continue;
    }
    if (id === scheduler.currentId && !scheduler.parked) {
      if (context.frames.length !== frames.length || context.frames.some((frame, position) => frame.id !== frames[position].id)) {
        invalid('Captured active context differs from its frame stack');
      }
      continue;
    }
    addFrames(index, context.frames, context);
  }
  if (scheduler && !contexts.has(scheduler.currentId)) invalid('Captured current context is missing');
  if (scheduler?.parked && frames.length) invalid('Parked snapshot retains an active frame stack');
  for (const id of index.frames.keys()) if (id > snapshot.frameId) invalid('Captured frame exceeds its identity sequence');
}
