import {isFatalFault, markUnhandled} from './unhandled.js';
import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {admitStackBytes, hasStackBudget, stackByteLimit, validateStackByteSnapshot} from './stack-budget.js';
import {sourceStackSlots} from './source-stack-size.js';
import {emitSourceException} from './source-exception-events.js';
import {cancelObjectValueWork} from './object-value-state.js';

const admissions = new WeakMap();
const terminal = new Set(['completed', 'faulted', 'canceled']);

function admit(vm, frame) {
  const limit = stackByteLimit(vm.options);
  if (limit === undefined) return;
  const epoch = executionCodeState(vm);
  const method = vm.image.methods[frame.methodId];
  const previous = admissions.get(frame);
  if (!method) throw new ManagedFault('InvalidProgramException', 'Source frame has no verified method body');
  if (previous?.epoch === epoch && previous.limit === limit && previous.id === frame.id && previous.method === method &&
      previous.code === method.code && previous.handlers === method.handlers && previous.locals === method.locals &&
      previous.localCount === frame.locals.length && previous.metadataLocalCount === method.locals.length &&
      previous.methods === vm.image.methods && hasStackBudget(vm)) return;
  const capacity = sourceStackSlots(vm, method);
  if (!Number.isSafeInteger(frame.base) || frame.base < 0 || vm.stack.length < frame.base || vm.stack.length - frame.base > capacity) {
    throw new ManagedFault('InvalidProgramException', 'Frame exceeds its verified source stack bound');
  }
  admitStackBytes(vm, frame);
  const id = frame.id, code = method.code, handlers = method.handlers, locals = method.locals;
  const localCount = frame.locals.length, metadataLocalCount = method.locals.length, methods = vm.image.methods;
  // Frame pooling changes the logical id, but its private admission record can
  // be reused after validation and all potentially observable reads succeed.
  const entry = previous ?? {};
  entry.epoch = epoch;
  entry.limit = limit;
  entry.id = id;
  entry.method = method;
  entry.code = code;
  entry.handlers = handlers;
  entry.locals = locals;
  entry.localCount = localCount;
  entry.metadataLocalCount = metadataLocalCount;
  entry.methods = methods;
  if (!previous) admissions.set(frame, entry);
}

/** Quota rejection precedes pc/counter/profiler changes; ordinary managed faults keep their existing path. */
export function beginSourceStackInstruction(vm, frame) {
  if (vm.options.maxStackBytes === undefined) return true;
  try {
    admit(vm, frame);
    return true;
  } catch (error) {
    vm.fault = vm.makeFault(error);
    markUnhandled(vm, vm.fault);
    emitSourceException(vm, vm.fault, {frame, opcode: null, index: frame.pc, method: frame.methodId, frameId: frame.id}, true);
    return false;
  }
}

/** Preserve the source interpreter's debugger/managed-exception adapter at the extracted seam. */
export function handleSourceInstructionFault(vm, error, instruction) {
  if (instruction.frame) cancelObjectValueWork(instruction.frame);
  const fault = vm.makeFault(error);
  const fatal = isFatalFault(fault);
  emitSourceException(vm, fault, instruction, fatal);
  if (fatal) {
    markUnhandled(vm, fault);
    return false;
  }
  vm.handleFault(fault);
  return true;
}

function validateContext(vm, frames, stack) {
  if (!Array.isArray(frames) || !Array.isArray(stack)) throw new TypeError('Invalid snapshot source stack');
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    const method = vm.image.methods[frame?.methodId];
    if (!method || !Array.isArray(frame.locals)) throw new TypeError('Invalid snapshot source frame');
    const end = index + 1 < frames.length ? frames[index + 1]?.base : stack.length;
    const capacity = sourceStackSlots(vm, method);
    const unownedPrefix = index === 0 && frame.base !== 0;
    if (!Number.isSafeInteger(frame.base) || !Number.isSafeInteger(end) || frame.base < 0 || unownedPrefix ||
        end < frame.base || end > stack.length || end - frame.base > capacity) {
      throw new TypeError('Snapshot exceeds the verified source stack bound');
    }
  }
  if (!frames.length && stack.length) throw new TypeError('Snapshot source stack has no owning frame');
}

/** Validate shared-stack segments and VM-wide reserved capacities before any restore mutation. */
export function validateSourceStackSnapshot(vm, snapshot) {
  validateContext(vm, snapshot.frames, snapshot.stack);
  const scheduler = snapshot.scheduler;
  if (scheduler) {
    if (!Array.isArray(scheduler.contexts)) throw new TypeError('Invalid snapshot scheduler contexts');
    for (const [id, context] of scheduler.contexts) {
      if (terminal.has(context.status) || id === scheduler.currentId && !scheduler.parked) continue;
      validateContext(vm, context.frames, context.stack);
    }
  }
  validateStackByteSnapshot(vm, snapshot);
}
