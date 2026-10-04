import {executionCodeState} from '../code-version.js';
import {executeCilStep, cilStepActive} from '../cil-step.js';
import {runCilSlice, cilSliceActive} from '../cil-slice.js';
import {getDecodePlan} from '../decode-plan.js';
import {lowerWasmIR} from './eligibility.js';
import {instantiateWasmIR} from './compile.js';
import {createWasmImports} from './imports.js';
import {wasmFrameSuppressed} from './deopt.js';

const handles = new WeakMap();
const optionNames = new Set(['maxMethodInstructions', 'maxAnalysisSlots', 'maxBytes']);

function failure(code, message) { return Object.assign(new TypeError(message), {code}); }

function configuration(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Wasm preparation options must be an object');
  for (const name of Object.keys(options)) if (!optionNames.has(name)) throw new TypeError('Unknown Wasm preparation option: ' + name);
  return {
    analysis: {maxMethodInstructions: options.maxMethodInstructions, maxAnalysisSlots: options.maxAnalysisSlots},
    encoding: {maxMethodInstructions: options.maxMethodInstructions, maxBytes: options.maxBytes}
  };
}

function current(record) {
  const {vm, method} = record;
  return !record.disposed && vm.inspector === record.inspector && vm.heap === record.heap &&
    vm.report === record.report && vm.report.success && executionCodeState(vm) === record.epoch &&
    method.instructions === record.body && method.handlers === record.handlers && method.maxStack === record.maxStack &&
    method.signature === record.signature && method.signature.parameters === record.parameters && method.locals === record.locals &&
    method.token === record.token && method.genericIdentity === record.genericIdentity &&
    method.typeArguments === record.typeArguments && method.methodArguments === record.methodArguments &&
    vm.inspector.getMethod(method.token).instructions === record.body;
}

function requireCurrent(record) {
  if (record.disposed) throw failure('WASM_DISPOSED', 'Compiled method handle was disposed');
  if (!current(record)) throw failure('WASM_STALE', 'Compiled method handle belongs to an earlier VM code generation');
}

function clearContext(context) {
  context.active = false;
  context.vm = context.frame = context.method = context.instruction = context.handler = null;
  context.frameId = context.index = -1;
}

function release(record) {
  record.disposed = true;
  clearContext(record.context);
  record.vm = record.heap = record.inspector = record.report = record.epoch = record.method = null;
  record.body = record.handlers = record.signature = record.parameters = record.locals = record.methodArguments = record.typeArguments = null;
  record.plan = record.ir = record.compiled = record.entries = record.executor = null;
}

function dispatch(record, frame, instruction, index, handler) {
  const vm = record.vm;
  const operation = record.ir.instructions[index];
  if (wasmFrameSuppressed(vm, frame) || frame.method !== record.method || record.plan.instructions[index] !== instruction ||
      record.plan.handlers[index] !== handler || operation?.depth === null || operation?.depth !== frame.stack.length) {
    return handler(vm, frame, instruction);
  }
  const context = record.context;
  if (context.active) throw failure('WASM_REENTRANT', 'Compiled instruction is already active');
  context.vm = vm;
  context.frame = frame;
  context.method = frame.method;
  context.frameId = frame.id;
  context.index = index;
  context.instruction = instruction;
  context.handler = handler;
  context.active = true;
  try {
    record.entries[index]();
  } finally {
    // Clear before the shared step envelope flushes retired frame storage.
    clearContext(context);
    if (record.releasePending) release(record);
  }
}

/** Compile one actual direct-CIL method without running or installing it. Rejections leave execution state unchanged. */
export async function prepareWasmMethod(vm, method = vm.top?.method, options = {}) {
  if (!vm.inspector || !vm.report || !vm.scheduler) throw failure('WASM_ENGINE', 'Compiled methods require a direct-CIL VM');
  const settings = configuration(options);
  const epoch = executionCodeState(vm);
  const ir = lowerWasmIR(vm, method, settings.analysis);
  const record = {vm, heap: vm.heap, inspector: vm.inspector, report: vm.report, epoch, method,
    body: method.instructions, handlers: method.handlers, maxStack: method.maxStack, signature: method.signature,
    parameters: method.signature.parameters, locals: method.locals, genericIdentity: method.genericIdentity,
    token: method.token, typeArguments: method.typeArguments, methodArguments: method.methodArguments,
    ir, plan: getDecodePlan(vm, method), context: {}, disposed: false};
  clearContext(record.context);
  try {
    record.compiled = await instantiateWasmIR(ir, createWasmImports(record.context), settings.encoding);
    requireCurrent(record);
    record.entries = ir.instructions.map(instruction => record.compiled.instance.exports['p' + instruction.pc]);
    const dispatcher = (machine, frame, instruction, index, handler) => dispatch(record, frame, instruction, index, handler);
    record.executor = {validate: () => requireCurrent(record), step: machine => executeCilStep(machine, dispatcher)};
    const handle = Object.freeze({methodToken: method.token, name: method.owner + '::' + method.name,
      byteLength: record.compiled.byteLength});
    handles.set(handle, record);
    return handle;
  } catch (error) {
    release(record);
    throw error;
  }
}

/** Run an ordinary bounded CIL slice, manually selecting one prepared method; other methods remain interpreted. */
export function runWasmSlice(vm, handle, options = {}) {
  const record = handles.get(handle);
  if (!record) throw failure('WASM_HANDLE', 'Unknown compiled method handle');
  if (record.disposed) throw failure('WASM_DISPOSED', 'Compiled method handle was disposed');
  if (record.vm !== vm) throw failure('WASM_OWNER', 'Compiled method handle belongs to another VM');
  requireCurrent(record);
  if (cilSliceActive(vm) || cilStepActive(vm)) throw failure('WASM_REENTRANT', 'CIL execution is already active for this VM');
  return runCilSlice(vm, options, record.executor);
}

/** Release a host-owned compiled handle at a slice boundary. Returns false after the first disposal. */
export function disposeWasmMethod(handle) {
  const record = handles.get(handle);
  if (!record) throw failure('WASM_HANDLE', 'Unknown compiled method handle');
  if (record.disposed) return false;
  if (cilSliceActive(record.vm) || cilStepActive(record.vm)) {
    throw failure('WASM_REENTRANT', 'Cannot dispose a compiled handle during its VM execution');
  }
  release(record);
  return true;
}

/** Internal tier-owned lease. Stale selections fall back before consuming any operands. */
export function preparedWasmDispatch(vm, handle) {
  const record = handles.get(handle);
  if (!record || record.vm !== vm) throw failure('WASM_OWNER', 'Compiled method belongs to another VM');
  requireCurrent(record);
  return Object.freeze({
    current: () => current(record),
    canEnter: frame => {
      if (wasmFrameSuppressed(vm, frame) || !current(record) || record.context.active || frame.method !== record.method) return false;
      const index = frame.pc, operation = record.ir.instructions[index];
      return operation?.depth !== null && operation?.depth === frame.stack.length &&
        record.plan.instructions[index] === frame.method.instructions[index];
    },
    dispatch: (machine, frame, instruction, index, handler) => {
      if (machine !== vm || !current(record)) return handler(machine, frame, instruction);
      return dispatch(record, frame, instruction, index, handler);
    },
    dispose: () => {
      if (record.disposed) return;
      // A host callback can invalidate code inside a canonical imported helper.
      // Finish that instruction before releasing its active import context.
      if (record.context.active) record.releasePending = true;
      else release(record);
    }
  });
}
