import {ManagedFault} from '../heap.js';
import {callStorageType} from '@sharpforge/cil';
import {sourceStackSlots} from './source-stack-size.js';

export const defaultStackBytes = 1024 * 1024;
const slotBytes = 8;
const frameHeaderBytes = 16;
const terminal = new Set(['completed', 'faulted', 'canceled']);

function limitFor(vm) {
  const limit = vm.options.maxStackBytes ?? defaultStackBytes;
  if (!Number.isSafeInteger(limit) || limit < frameHeaderBytes) {
    throw new RangeError('maxStackBytes must be a safe integer of at least 16 bytes');
  }
  return limit;
}

function storageBytes(vm, type) {
  const table = vm.heap.methodTables.get(callStorageType(type).replace(/\s+pinned$/, ''));
  const bytes = table.flags.valueType ? table.valueSize : slotBytes;
  return Math.max(slotBytes, Math.ceil(bytes / slotBytes) * slotBytes);
}

/** Logical managed bytes, not a claim about JavaScript engine object sizes. */
function declaredFrameBytes(vm, frame) {
  if (frame.method) {
    const method = frame.method;
    let bytes = frameHeaderBytes + method.maxStack * slotBytes;
    if (!method.signature.isStatic) bytes += slotBytes;
    for (const type of method.signature.parameters) bytes += storageBytes(vm, type);
    for (const type of method.locals) bytes += storageBytes(vm, type);
    return bytes;
  }
  const method = vm.image.methods[frame.methodId];
  let bytes = frameHeaderBytes + sourceStackSlots(method, vm.image.constants) * slotBytes;
  // Source locals include argument slots, so they are counted exactly once.
  for (const local of method.locals) bytes += storageBytes(vm, local.type);
  return bytes;
}

export function frameStackBytes(vm, frame) {
  return declaredFrameBytes(vm, frame) + (frame.varargs ?? []).reduce((bytes, argument) =>
    bytes + storageBytes(vm, argument.type.name), 0);
}

function overflow() {
  const fault = new ManagedFault('StackOverflowException', 'Managed stack byte budget exceeded');
  fault.fatal = true;
  fault.runtimeOrigin = true;
  return fault;
}

/** Per-VM derived accounting. O(1) admission/release after a method's size is cached. */
export class ManagedStackBudget {
  constructor(vm) {
    this.vm = vm;
    this.limit = limitFor(vm);
    this.contexts = new Map();
    this.frames = new Map();
    this.methodSizes = new WeakMap();
  }

  size(frame) {
    const method = frame.method ?? this.vm.image.methods[frame.methodId];
    let bytes = this.methodSizes.get(method);
    if (bytes === undefined) {
      bytes = declaredFrameBytes(this.vm, frame);
      if (!Number.isSafeInteger(bytes) || bytes < frameHeaderBytes) {
        throw new ManagedFault('InvalidProgramException', 'Invalid managed frame size');
      }
      this.methodSizes.set(method, bytes);
    }
    return bytes + (frame.varargs ?? []).reduce((total, argument) => total + storageBytes(this.vm, argument.type.name), 0);
  }

  register(frame, contextId = this.vm.scheduler?.currentId ?? 1) {
    if (this.frames.has(frame.id)) return;
    const bytes = this.size(frame);
    const current = this.contexts.get(contextId) ?? 0;
    if (bytes > this.limit - current) throw overflow();
    this.contexts.set(contextId, current + bytes);
    this.frames.set(frame.id, {contextId, bytes});
    frame.stackBytes = bytes;
    frame.stackContextId = contextId;
  }

  replace(previous, next, contextId = this.vm.scheduler?.currentId ?? 1) {
    const old = this.frames.get(previous.id);
    if (!old || old.contextId !== contextId) throw new TypeError('Tail frame budget context mismatch');
    const bytes = this.size(next);
    const current = this.contexts.get(contextId) - old.bytes;
    if (bytes > this.limit - current) throw overflow();
    this.frames.delete(previous.id);
    this.frames.set(next.id, {contextId, bytes});
    this.contexts.set(contextId, current + bytes);
    next.stackBytes = bytes;
    next.stackContextId = contextId;
  }

  release(frame) {
    const entry = this.frames.get(frame.id);
    if (!entry) return;
    const remaining = this.contexts.get(entry.contextId) - entry.bytes;
    if (remaining) this.contexts.set(entry.contextId, remaining);
    else this.contexts.delete(entry.contextId);
    this.frames.delete(frame.id);
  }

  clear() {
    this.contexts.clear();
    this.frames.clear();
  }
}

function budgetFor(vm) {
  vm.stackBudget ??= new ManagedStackBudget(vm);
  return vm.stackBudget;
}

/** Admit before pushing. A rejected frame changes neither totals nor live frames. */
export function registerStackFrame(vm, frame) {
  budgetFor(vm).register(frame);
}

/** Validate a replacement before removing its caller's accounting. */
export function replaceStackFrame(vm, previous, next) {
  budgetFor(vm).replace(previous, next);
}

/** Release once on ret, exceptional exit, tail transfer or filter completion. */
export function releaseStackFrame(vm, frame) {
  vm.stackBudget?.release(frame);
}

export function clearStackBudget(vm) {
  vm.stackBudget?.clear();
}

/** Reconstruct derived counters after restore; parked contexts own separate stacks. */
export function rebuildStackBudget(vm) {
  const budget = new ManagedStackBudget(vm);
  if (vm.scheduler?.enabled) {
    for (const [id, context] of vm.scheduler.contexts) {
      if (terminal.has(context.status) && !context.preserveFrames) continue;
      const frames = id === vm.scheduler.currentId && !vm.scheduler.parked ? vm.frames : context.frames;
      for (const frame of frames) budget.register(frame, id);
    }
  } else {
    for (const frame of vm.frames) budget.register(frame, 1);
  }
  vm.stackBudget = budget;
  return budget;
}

/** Validate saved accounting against metadata before any restore mutation. */
export function validateStackSnapshot(vm, snapshot) {
  const limit = limitFor(vm);
  const totals = new Map();
  const seen = new Set();
  const add = (frame, contextId) => {
    if (seen.has(frame.id)) return;
    seen.add(frame.id);
    const bytes = frameStackBytes(vm, frame);
    if (frame.stackBytes !== bytes || frame.stackContextId !== contextId) {
      throw new TypeError('Invalid snapshot stack accounting');
    }
    const total = (totals.get(contextId) ?? 0) + bytes;
    if (total > limit) throw new TypeError('Snapshot exceeds managed stack byte budget');
    totals.set(contextId, total);
  };
  if (snapshot.scheduler) {
    for (const [id, context] of snapshot.scheduler.contexts) {
      if (!terminal.has(context.status) || context.preserveFrames) for (const frame of context.frames) add(frame, id);
    }
    for (const frame of snapshot.frames) add(frame, snapshot.scheduler.currentId);
  } else {
    for (const frame of snapshot.frames) add(frame, 1);
  }
}
