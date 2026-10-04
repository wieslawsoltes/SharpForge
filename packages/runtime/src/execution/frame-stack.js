import {verifiedStackBound} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {stackByteLimit, admitStackBytes, validateStackByteSnapshot} from './stack-budget.js';

const admissions = new WeakMap();
const frameAdmissions = new WeakMap();

export function stackValueLimit(options) {
  return validStackValueLimit(options.maxStackValues ?? 65536);
}

function validStackValueLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError('maxStackValues must be a nonnegative safe integer');
  }
  return limit;
}

function boundsFor(vm, method) {
  const epoch = executionCodeState(vm);
  let cache = admissions.get(vm);
  if (!cache || cache.epoch !== epoch || cache.report !== vm.report) {
    cache = {epoch, report: vm.report, methods: new WeakMap()};
    admissions.set(vm, cache);
  }
  let entry = cache.methods.get(method);
  if (!entry || entry.instructions !== method.instructions || entry.handlers !== method.handlers || entry.capacity !== method.maxStack) {
    const bound = verifiedStackBound(vm.inspector, vm.report, method);
    entry = {instructions: method.instructions, handlers: method.handlers, capacity: method.maxStack, bound};
    cache.methods.set(method, entry);
  }
  return entry.bound;
}

/** Re-admit restored or replaced bodies before dispatch; stale bodies retain checked pushes. */
export function beginFrameInstruction(vm, frame) {
  const epoch = executionCodeState(vm), previous = frameAdmissions.get(frame), method = frame.method;
  const limit = stackValueLimit(vm.options), byteLimit = stackByteLimit(vm.options);
  if (previous?.epoch === epoch && previous.report === vm.report && previous.method === method &&
      previous.instructions === method.instructions && previous.handlers === method.handlers &&
      previous.capacity === method.maxStack && previous.limit === limit && previous.byteLimit === byteLimit &&
      previous.signature === method.signature && previous.parameters === method.signature.parameters && previous.locals === method.locals) return;
  admitCilStack(vm, method);
  const bound = boundsFor(vm, method);
  if (bound && frame.stack.length > bound.peak) {
    throw new ManagedFault('InvalidProgramException', 'Frame exceeds its verified evaluation-stack bound');
  }
  admitStackBytes(vm, frame);
  frameAdmissions.set(frame, {epoch, report: vm.report, method, verified: bound !== null, instructions: method.instructions,
    handlers: method.handlers, capacity: method.maxStack, limit, byteLimit, signature: method.signature,
    parameters: method.signature.parameters, locals: method.locals});
}

/** Host quotas apply to the reachable peak, not an overestimated CLI header. */
export function admitCilStack(vm, method) {
  const limit = stackValueLimit(vm.options);
  const bound = boundsFor(vm, method);
  if (!bound) return Math.min(method.maxStack, limit);
  if (bound.peak > limit) throw new ManagedFault('ExecutionLimitException', 'Evaluation stack budget exceeded');
  return Math.min(bound.capacity, limit);
}

/** Check all reachable bodies before allocating a VM's managed execution state. */
export function admitCilAssemblyStacks(vm) {
  stackValueLimit(vm.options);
  stackByteLimit(vm.options);
  for (const token of vm.report.methods) admitCilStack(vm, vm.inspector.getMethod(token));
}

/** Admitted CIL code is bounded by verification; no global comparison on its push path. */
export function pushStackValue(vm, value) {
  const frame = vm.top;
  const admitted = frameAdmissions.get(frame);
  const limit = vm.options.maxStackValues ?? 65536;
  const method = frame.method;
  const verified = admitted?.verified && admitted.report === vm.report && admitted.method === method &&
    admitted.instructions === method.instructions && admitted.handlers === method.handlers &&
    admitted.capacity === method.maxStack && admitted.limit === limit && admitted.signature === method.signature &&
    admitted.parameters === method.signature.parameters && admitted.locals === method.locals && admitted.epoch === executionCodeState(vm);
  if (!verified && frame.stack.length >= validStackValueLimit(limit)) {
    throw new ManagedFault('ExecutionLimitException', 'Evaluation stack budget exceeded');
  }
  if (!verified || admitted.byteLimit !== vm.options.maxStackBytes) admitStackBytes(vm, frame);
  frame.stack.push(value);
}

/** Preflight active and parked stacks without changing live VM, scheduler or heap state. */
export function validateCilStackSnapshot(vm, snapshot) {
  const seen = new Set();
  const frames = list => {
    if (!Array.isArray(list)) throw new TypeError('Invalid snapshot frame list');
    for (const frame of list) {
      if (seen.has(frame)) continue;
      seen.add(frame);
      if (!frame?.method || !Array.isArray(frame.stack)) throw new TypeError('Invalid snapshot CIL frame');
      const capacity = admitCilStack(vm, frame.method);
      const bound = boundsFor(vm, frame.method);
      if (frame.stack.length > (bound ? Math.min(capacity, bound.peak) : stackValueLimit(vm.options))) {
        throw new TypeError('Snapshot exceeds the verified evaluation-stack bound');
      }
    }
  };
  frames(snapshot.frames);
  if (snapshot.scheduler) {
    if (!Array.isArray(snapshot.scheduler.contexts)) throw new TypeError('Invalid snapshot scheduler contexts');
    for (const row of snapshot.scheduler.contexts) {
      if (!Array.isArray(row) || row.length !== 2) throw new TypeError('Invalid snapshot scheduler context');
      frames(row[1]?.frames);
    }
  }
  validateStackByteSnapshot(vm, snapshot);
}
