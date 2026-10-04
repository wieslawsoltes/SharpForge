import {verifiedStackBound} from '@sharpforge/cil';
import {verifiedSourceStackBound, verifyImage} from '@sharpforge/bytecode';
import {ownsHeapReference} from './heap-reference.js';
import {executionCodeState} from './code-version.js';
import {floatSlotRoot} from './typed-stack.js';
import {scalarStorageGuard} from './scalar-storage-plan.js';
import {slotLiveness, liveSlot, slotLivenessLimits} from './slot-liveness.js';

const caches = new WeakMap();
const maximumPlanBytes = 8 * 1024 * 1024;

/** Captured slots remain roots for the frame lifetime, including across snapshots. */
export function captureFrameSlot(frame, kind, index) {
  if (kind !== 'arg' && kind !== 'local') return;
  const field = kind === 'arg' ? 'args' : 'locals';
  if (!Number.isSafeInteger(index) || index < 0 || index >= frame[field].length) return;
  frame.rootCaptures ??= {args: new Set(), locals: new Set()};
  frame.rootCaptures[field].add(index);
}

function cacheFor(vm) {
  const epoch = executionCodeState(vm);
  let cache = caches.get(vm);
  if (!cache || cache.epoch !== epoch) {
    cache = {epoch, methods: new WeakMap(), bytes: 0};
    caches.set(vm, cache);
  }
  return cache;
}

function typesFor(method) {
  if (!method.signature) return method.locals.map(local => local?.type);
  return [...(method.signature.isStatic ? [] : ['object']), ...method.signature.parameters, ...method.locals];
}

function sameTypes(method, types) {
  const arguments_ = method.signature ? method.signature.parameters.length + Number(!method.signature.isStatic) : 0;
  if (types.length !== arguments_ + method.locals.length) return false;
  for (let index = 0; index < types.length; index++) {
    let type;
    if (!method.signature) type = method.locals[index]?.type;
    else if (index >= arguments_) type = method.locals[index - arguments_];
    else type = !method.signature.isStatic && index === 0 ? 'object'
      : method.signature.parameters[index - Number(!method.signature.isStatic)];
    if (type !== types[index]) return false;
  }
  return true;
}

function referenceSlot(vm, type) {
  if (typeof type !== 'string' || scalarStorageGuard(type) || /[&*!]|\s/.test(type)) return false;
  try {
    const table = vm.heap.methodTables.get(type);
    return !table.flags.valueType && !table.flags.byRef && !table.flags.pointer && !table.containsGenericParameters &&
      !table.flags.dynamic;
  } catch (error) {
    // Invalid host-edited type metadata removes the pruning proof, never a root.
    if (error instanceof TypeError) return false;
    throw error;
  }
}

function exactProof(vm, method) {
  if (vm.inspector) return verifiedStackBound(vm.inspector, vm.report, method);
  let proof = verifiedSourceStackBound(vm.image, method);
  if (proof) return proof;
  // Source constructors need not request reusable stack proofs. Obtain one through
  // the existing verifier; malformed/replaced code simply retains conservative roots.
  if (verifyImage(vm.image, {stackBounds: true}).length) return null;
  proof = verifiedSourceStackBound(vm.image, method);
  return proof;
}

function planFor(vm, method, cache) {
  if (!Array.isArray(method.locals) || method.signature && (!Array.isArray(method.signature.parameters) ||
      typeof method.signature.isStatic !== 'boolean')) return null;
  const instructions = method.signature ? method.instructions?.length : method.code?.length / 3;
  const count = method.locals.length + (method.signature ? method.signature.parameters.length + Number(!method.signature.isStatic) : 0);
  if (!Number.isSafeInteger(instructions) || instructions < 1 || instructions > slotLivenessLimits.instructions ||
      count < 1 || count > slotLivenessLimits.slots || method.handlers?.length) return null;
  const proof = exactProof(vm, method);
  if (!proof) return null;
  const code = method.instructions ?? method.code;
  const entry = cache.methods.get(method);
  if (entry?.proof === proof && entry.code === code && sameTypes(method, entry.types)) return entry.plan;
  if (count * 8 + 128 > maximumPlanBytes - cache.bytes) return null;
  const types = typesFor(method), slots = [];
  for (let index = 0; index < types.length; index++) {
    if (referenceSlot(vm, types[index])) slots.push(index);
  }
  const liveness = slots.length && cache.bytes < maximumPlanBytes ? slotLiveness(method) : null;
  let plan = null;
  const bytes = 128 + (types.length + slots.length) * 8 + (liveness?.live.byteLength ?? 0);
  if (bytes > maximumPlanBytes - cache.bytes) return null;
  if (liveness) {
    plan = {liveness, slots};
  }
  cache.bytes += bytes;
  cache.methods.set(method, {proof, code, types, plan});
  return plan;
}

function captured(frame, field, index) {
  if (!frame.rootCaptures) return false;
  const slots = frame.rootCaptures[field];
  // Malformed host metadata cannot authorize deleting a potential root.
  return !(slots instanceof Set) || slots.has(index);
}

function pruneFrame(vm, frame, plan) {
  if (!Number.isSafeInteger(frame.pc) || frame.pc < 0) return;
  const {liveness, slots} = plan;
  for (const position of slots) {
    const argument = position < liveness.argumentCount;
    const field = argument ? 'args' : 'locals';
    const index = argument ? position : position - liveness.argumentCount;
    const values = frame[field];
    if (!values || captured(frame, field, index) || liveSlot(liveness, frame.pc, position) ||
        liveSlot(liveness, Math.max(0, frame.pc - 1), position)) continue;
    const value = floatSlotRoot(values, index);
    // Host-edited aggregates, byrefs and scalar-shaped handles stay conservative.
    if (!ownsHeapReference(vm.heap, value)) continue;
    values[index] = undefined;
  }
}

/** Optional pruning precedes the unchanged root inventory; parked/inspection states stay conservative. */
export function pruneDeadFrameRoots(vm) {
  if (vm.options.preciseRootLiveness !== true || vm.pendingFault || vm.fault || vm.state === 'paused' || vm.state === 'faulted') return;
  const cache = cacheFor(vm), checked = new WeakMap();
  for (const frame of vm.frames) {
    if (frame.filterOwnerId || frame.filterSearch || frame.intrinsicContinuation || frame.exceptionEventContinuation ||
        frame.delegateContinuation || frame.objectValueContinuation || frame.objectValueWork || frame.unwinds?.length || frame.pending) continue;
    const method = frame.method ?? vm.image?.methods[frame.methodId];
    if (!method) continue;
    let plan = checked.get(method);
    if (plan === undefined) {
      plan = planFor(vm, method, cache);
      checked.set(method, plan);
    }
    if (plan) pruneFrame(vm, frame, plan);
  }
}
