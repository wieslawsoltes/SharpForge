import {normalizeCallType, verifiedStackBound} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {sourceStackSlots} from './source-stack-size.js';
import {valueLayout} from './value-layout.js';
import {isAggregateType} from './value-types.js';

const budgets = new WeakMap();
const slotBytes = 8;
const frameHeaderBytes = 16;
const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Optional VM-wide logical managed stack bytes; omitted preserves the existing policy. */
export function stackByteLimit(options) {
  const limit = options.maxStackBytes;
  if (limit === undefined) return undefined;
  if (!Number.isSafeInteger(limit) || limit < frameHeaderBytes) {
    throw new RangeError('maxStackBytes must be a safe integer of at least 16 bytes');
  }
  return limit;
}

function overflow() {
  const fault = new ManagedFault('StackOverflowException', 'Managed stack byte budget exceeded');
  fault.fatal = true;
  return fault;
}

function storageBytes(vm, type) {
  // Custom modifiers affect access/call contracts, not physical storage width.
  const name = normalizeCallType(type).replace(/\s+mod(?:req|opt)\([^)]*\)/g, '').replace(/\s+pinned$/, '');
  const table = vm.inspector ? vm.typeSystem.table(name) : vm.heap.methodTables.get(name);
  const layout = table.flags.nullable || vm.inspector && isAggregateType(table);
  const bytes = layout ? valueLayout(vm, table).size : table.flags.valueType ? table.valueSize : slotBytes;
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('Invalid managed stack storage size');
  return Math.max(slotBytes, Math.ceil(bytes / slotBytes) * slotBytes);
}

function newBudget(vm) {
  return {epoch: executionCodeState(vm), report: vm.report, valueLimit: vm.options.maxStackValues ?? 65536,
    imageMethods: vm.image?.methods, methods: new WeakMap(), frames: new Map(), total: 0};
}

function methodSize(vm, budget, method) {
  const cil = !!vm.inspector, code = cil ? method.instructions : method.code, signature = method.signature;
  let entry = budget.methods.get(method);
  if (entry && entry.code === code && entry.handlers === method.handlers && entry.capacity === method.maxStack &&
      entry.signature === signature && entry.parameters === signature?.parameters && entry.locals === method.locals) return entry;
  let capacity;
  if (cil) {
    const bound = verifiedStackBound(vm.inspector, vm.report, method);
    // Replaced/unverified CIL bodies can use the entire checked global limit.
    capacity = bound ? Math.min(bound.capacity, budget.valueLimit) : budget.valueLimit;
  } else capacity = sourceStackSlots(vm, method);
  let bytes = frameHeaderBytes + capacity * slotBytes;
  const arguments_ = cil ? signature.parameters.length + (signature.isStatic ? 0 : 1) : 0;
  if (cil) {
    if (!signature.isStatic) bytes += slotBytes;
    for (const type of signature.parameters) bytes += storageBytes(vm, type);
  }
  // Source argument slots already appear in locals; no second argument plane is charged.
  for (const local of method.locals) bytes += storageBytes(vm, cil ? local : local.type);
  if (!Number.isSafeInteger(bytes) || bytes < frameHeaderBytes) throw new TypeError('Invalid managed frame size');
  entry = {code, handlers: method.handlers, capacity: method.maxStack, signature,
    parameters: signature?.parameters, locals: method.locals, arguments: arguments_, bytes};
  budget.methods.set(method, entry);
  return entry;
}

function frameBytes(vm, budget, method, arguments_, locals = method.locals.length) {
  const entry = methodSize(vm, budget, method);
  const extra = vm.inspector
    ? Math.max(0, arguments_ - entry.arguments) + Math.max(0, locals - method.locals.length)
    : Math.max(0, Math.max(arguments_, locals) - method.locals.length);
  const bytes = entry.bytes + extra * slotBytes;
  if (!Number.isSafeInteger(bytes)) throw new TypeError('Invalid managed frame size');
  return bytes;
}

function existingFrameBytes(vm, budget, frame) {
  const method = frame.method ?? vm.image.methods[frame.methodId];
  return frameBytes(vm, budget, method, frame.args?.length ?? 0, frame.locals.length);
}

function visitFrames(execution, visit) {
  for (const frame of execution.frames) visit(frame);
  const scheduler = execution.scheduler;
  // Runtime schedulers have enabled; a non-null saved scheduler is enabled by definition.
  if (!scheduler || scheduler.enabled === false) return;
  for (const [id, context] of scheduler.contexts) {
    if (terminal.has(context.status)) continue;
    const current = id === scheduler.currentId && !scheduler.parked;
    // enqueue temporarily switches vm.frames before assigning the child's context id.
    // Saved current frames are independent copies, so snapshots use the active list once.
    if (current && (scheduler.enabled === undefined || context.frames === execution.frames)) continue;
    for (const frame of context.frames) visit(frame);
  }
}

function rebuild(vm, execution = vm) {
  const budget = newBudget(vm);
  visitFrames(execution, frame => {
    if (budget.frames.has(frame)) return;
    const bytes = existingFrameBytes(vm, budget, frame);
    budget.frames.set(frame, bytes);
    budget.total += bytes;
    if (!Number.isSafeInteger(budget.total)) throw new TypeError('Invalid managed stack size');
  });
  return budget;
}

function budgetFor(vm) {
  let budget = budgets.get(vm);
  if (!budget || budget.epoch !== executionCodeState(vm) || budget.report !== vm.report ||
      budget.valueLimit !== (vm.options.maxStackValues ?? 65536) || budget.imageMethods !== vm.image?.methods) {
    budget = rebuild(vm);
    budgets.set(vm, budget);
  }
  return budget;
}

/** Reserve before pool allocation. The ticket supports rollback if construction fails. */
export function reserveStackFrame(vm, method, argumentCount) {
  const limit = stackByteLimit(vm.options);
  if (limit === undefined) {
    budgets.delete(vm);
    return null;
  }
  const budget = budgetFor(vm);
  const bytes = frameBytes(vm, budget, method, argumentCount);
  if (bytes > limit - budget.total) throw overflow();
  budget.total += bytes;
  return {budget, bytes, active: true};
}

export function commitStackFrame(ticket, frame) {
  if (!ticket) return;
  ticket.budget.frames.set(frame, ticket.bytes);
  ticket.active = false;
}

export function cancelStackFrame(ticket) {
  if (!ticket?.active) return;
  ticket.budget.total -= ticket.bytes;
  ticket.active = false;
}

/** Reconcile a restored/replaced frame, then observe the current host byte limit. */
export function admitStackBytes(vm, frame) {
  const limit = stackByteLimit(vm.options);
  if (limit === undefined) {
    budgets.delete(vm);
    return;
  }
  const budget = budgetFor(vm);
  const bytes = existingFrameBytes(vm, budget, frame);
  const total = budget.total - (budget.frames.get(frame) ?? 0) + bytes;
  if (total > limit) throw overflow();
  budget.frames.set(frame, bytes);
  budget.total = total;
}

/** Retiring a frame releases live-stack accounting, independent of pool retention. */
export function releaseStackFrame(vm, frame) {
  const budget = budgets.get(vm);
  const bytes = budget?.frames.get(frame);
  if (bytes === undefined) return;
  budget.total -= bytes;
  budget.frames.delete(frame);
}

export function clearStackBudget(vm) {
  budgets.delete(vm);
}

/** A call made with the quota disabled discards accounting and requires fresh admission. */
export function hasStackBudget(vm) {
  return budgets.has(vm);
}

/** Preflight metadata-derived bytes before restore mutates heap, scheduler or VM state. */
export function validateStackByteSnapshot(vm, snapshot) {
  const limit = stackByteLimit(vm.options);
  if (limit !== undefined && rebuild(vm, snapshot).total > limit) {
    throw new TypeError('Snapshot exceeds managed stack byte budget');
  }
}
