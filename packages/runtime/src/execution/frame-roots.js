import {callStorageType} from '@sharpforge/cil';
import {numericTypeName, numericTypeNames} from '@sharpforge/bytecode';
import {numericSlotRoot} from './typed-stack.js';
import {slotLiveness, liveSlot} from './slot-liveness.js';
import {framePool} from './frame-pool.js';
import {numericStackTypes, StackCategory} from './numeric-stack-types.js';
import {methodOffsets} from './method-offsets.js';
import {sourceInputTypes} from './source-storage.js';
import {initializationRoots} from './static-init.js';
import {runtimeTypeRoots} from './tokens.js';
import {stringRoots} from './strings.js';
import {asyncRoots} from './async-runtime.js';

const scalarTypes = new Set([...numericTypeNames, 'bool']);
const terminal = new Set(['completed', 'faulted', 'canceled']);
const numericCategories = new Set([StackCategory.i4, StackCategory.i8, StackCategory.r4, StackCategory.r8, StackCategory.native]);

function referenceType(type) {
  if (typeof type !== 'string') return true;
  return !scalarTypes.has(numericTypeName(callStorageType(type).replace(/\s+pinned$/, '')));
}

function candidate(value) {
  return value !== null && typeof value === 'object' && (Number.isInteger(value.h) || value.byref || value.memoryPointer ||
    value.valueType || value.span || value.nullableType || value.typedReference);
}

function offer(value, visit) {
  if (candidate(value)) visit(value);
}

function values(values, visit) {
  if (!values) return;
  for (let index = 0; index < values.length; index++) offer(numericSlotRoot(values, index), visit);
}

function planFor(vm, frame) {
  const pool = framePool(vm), method = frame.method ?? vm.image.methods[frame.methodId];
  pool.rootPlans ??= new WeakMap();
  let plan = pool.rootPlans.get(method);
  const code = method.instructions ?? method.code;
  if (plan?.code === code) return plan;
  const cil = !!method.signature;
  const argumentTypes = cil ? [...(method.signature.isStatic ? [] : ['object']), ...method.signature.parameters] : [];
  const localTypes = cil ? method.locals : method.locals.map(local => local.type);
  const slots = [];
  for (let index = 0; index < argumentTypes.length; index++) {
    if (referenceType(argumentTypes[index])) slots.push({argument: true, index, position: index});
  }
  for (let index = 0; index < localTypes.length; index++) {
    if (referenceType(localTypes[index])) slots.push({argument: false, index, position: argumentTypes.length + index});
  }
  plan = {code, liveness: slotLiveness(method), slots,
    argumentCount: argumentTypes.length, localCount: localTypes.length,
    stackTypes: cil ? numericStackTypes(vm.inspector, method, methodOffsets(method)) : null};
  pool.rootPlans.set(method, plan);
  return plan;
}

/** Continuation slots are roots independent of IL local liveness and declared result type. */
export function visitFrameContinuations(frame, visit) {
  offer(frame.returnObject, visit);
  offer(frame.asyncBuilderTask, visit);
  offer(frame.exception?.reference, visit);
  offer(frame.filterSearch?.error.reference, visit);
  for (const caught of frame.caught ?? []) offer(caught.fault?.reference, visit);
  for (const unwind of frame.unwinds ?? []) {
    offer(unwind.error?.reference, visit);
    offer(unwind.value, visit);
  }
  const delegate = frame.delegateContinuation;
  if (delegate) { values(delegate.delegates, visit); values(delegate.args, visit); }
  const event = frame.exceptionEventContinuation;
  if (event) { offer(event.fault.reference, visit); values(event.handlers, visit); values(event.args, visit); }
  if (frame.intrinsicContinuation?.kind === 'array') offer(frame.intrinsicContinuation.reference, visit);
}

/** Non-generator scan; typed numeric planes never materialize scalar wrappers here. */
export function visitFrameRoots(vm, frame, visit, sourceStack = null, end = sourceStack?.length ?? 0) {
  const plan = planFor(vm, frame), active = vm.framePool.activeFrame === frame;
  const pc = Math.max(0, frame.pc - Number(active));
  const prune = vm.options.preciseRootLiveness !== false && !frame.filterOwnerId;
  for (const slot of plan.slots) {
    const array = slot.argument ? frame.args : frame.locals;
    const value = numericSlotRoot(array, slot.index);
    if (value === undefined || value === null) continue;
    // A dead handle cannot remain in a portable snapshot after its record dies.
    if (prune && !liveSlot(plan.liveness, pc, slot.position)) array[slot.index] = undefined;
    else offer(value, visit);
  }
  // Optional varargs are addressable beyond the fixed signature/local table.
  for (let index = plan.argumentCount; index < (frame.args?.length ?? 0); index++) offer(numericSlotRoot(frame.args, index), visit);
  for (let index = plan.localCount; index < frame.locals.length; index++) offer(numericSlotRoot(frame.locals, index), visit);
  const stack = frame.method ? frame.stack : sourceStack, start = frame.method ? 0 : frame.base;
  const length = frame.method ? stack.length : end;
  const types = frame.method ? plan.stackTypes[pc] : sourceInputTypes(vm, frame, pc);
  for (let index = start; index < length; index++) {
    const type = types?.[index - start];
    if (frame.method ? numericCategories.has(type) : type !== undefined && !referenceType(type)) continue;
    offer(numericSlotRoot(stack, index), visit);
  }
  visitFrameContinuations(frame, visit);
}

export function visitFrames(vm, frames, stack, visit) {
  for (let index = 0; index < frames.length; index++) {
    visitFrameRoots(vm, frames[index], visit, stack, frames[index + 1]?.base ?? stack?.length ?? 0);
  }
}

function visitScheduler(vm, visit) {
  const scheduler = vm.scheduler;
  offer(scheduler?.unhandledFault?.reference, visit);
  if (!scheduler?.enabled) return;
  for (const context of scheduler.contexts.values()) {
    if (terminal.has(context.status) && !context.preserveFrames) continue;
    offer(context.task, visit);
    offer(context.thread, visit);
    offer(context.delegate, visit);
    offer(context.returnValue, visit);
    offer(context.wait?.task, visit);
    offer(context.resumeFault?.reference, visit);
    if (context.id === scheduler.currentId && !scheduler.parked) continue;
    visitFrames(vm, context.frames, context.stack, visit);
    offer(context.pendingFault?.reference, visit);
    offer(context.fault?.reference, visit);
  }
  for (const task of scheduler.tasks.values()) if (!terminal.has(task.status)) {
    offer(task.ref, visit);
    iterable(task.dependencies, visit);
    offer(task.error?.reference, visit);
  }
}

function iterable(iterable, visit) {
  if (iterable) for (const value of iterable) offer(value, visit);
}

/** Heap rootProvider visitor contract. Calling the provider without a visitor retains roots() compatibility. */
export function visitVMRoots(vm, visit) {
  iterable(vm.platform?.roots(), visit);
  iterable(vm.sync?.roots(), visit);
  visitScheduler(vm, visit);
  if (vm.inspector) {
    iterable(asyncRoots(vm), visit);
    iterable(initializationRoots(vm), visit);
    iterable(vm.statics.values(), visit);
  } else {
    values(vm.statics, visit);
    iterable(vm.constantValues.values(), visit);
  }
  iterable(stringRoots(vm), visit);
  iterable(runtimeTypeRoots(vm), visit);
  offer(vm.returnValue, visit);
  offer(vm.fault?.reference, visit);
  offer(vm.pendingFault?.reference, visit);
  visitFrames(vm, vm.frames, vm.stack, visit);
  // Retired frames are inspected by return/delegate/EH callbacks until the
  // enclosing instruction completes; they cannot be pruned or recycled yet.
  for (const frame of vm.framePool?.pending ?? []) {
    values(frame.args, visit); values(frame.locals, visit); values(frame.stack, visit);
    visitFrameContinuations(frame, visit);
  }
}

export function installRootProvider(vm) {
  vm.heap.rootProvider = visit => visit && vm.options.preciseRoots !== false ? visitVMRoots(vm, visit) : vm.roots();
}
