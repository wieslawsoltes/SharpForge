import {ManagedFault} from '../heap.js';

const indexes = new WeakMap();
const terminal = new Set(['completed', 'faulted', 'canceled']);
const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };

function add(index, frame) {
  if (!Number.isSafeInteger(frame?.id) || frame.id < 1) invalid('Invalid live frame identity');
  const previous = index.get(frame.id);
  if (previous && previous !== frame) invalid('Duplicate live frame identity');
  index.set(frame.id, frame);
}

function collect(frames, scheduler) {
  const index = new Map();
  const insert = frame => {
    if (index.has(frame?.id)) invalid('Duplicate live frame identity');
    add(index, frame);
  };
  for (const frame of frames) insert(frame);
  if (scheduler?.enabled === false) return index;
  for (const [id, context] of scheduler?.contexts ?? []) {
    if (terminal.has(context.status) || id === scheduler.currentId && !scheduler.parked) continue;
    for (const frame of context.frames) insert(frame);
  }
  return index;
}

/** Rebuild derived identities after restore; active fatal frames remain available for inspection. */
export function rebuildFrameIndex(vm) {
  const index = collect(vm.frames, vm.scheduler);
  indexes.set(vm, index);
  return index;
}

/** Register only admitted frames. Parking preserves both frame identity and its index entry. */
export function registerFrame(vm, frame) {
  let index = indexes.get(vm);
  if (!index) index = rebuildFrameIndex(vm);
  add(index, frame);
}

/** End address lifetime before deferred pool clearing can recycle the object. */
export function releaseFrame(vm, frame) {
  const index = indexes.get(vm);
  if (index?.get(frame.id) === frame) index.delete(frame.id);
}

export function clearFrameIndex(vm) {
  indexes.delete(vm);
}

/** Lookup is O(1) after admission/rebuild; the index is never a managed GC root provider. */
export function frameById(vm, id) {
  const index = indexes.get(vm) ?? rebuildFrameIndex(vm);
  const frame = index.get(id);
  if (!frame || frame.id !== id) invalid('Managed address outlived its frame');
  return frame;
}

/** Reject conflicting captured identities without touching live frames, pools or the index. */
export function validateFrameIndexSnapshot(snapshot) {
  const index = collect(snapshot.frames, snapshot.scheduler);
  if (!Number.isSafeInteger(snapshot.frameId) || snapshot.frameId < 0) invalid('Invalid captured frame sequence');
  for (const id of index.keys()) if (id > snapshot.frameId) invalid('Captured frame exceeds its identity sequence');
}
