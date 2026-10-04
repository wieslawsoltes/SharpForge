import {VirtualMachine} from '../vm.js';
import {CilVirtualMachine} from '../cil-vm.js';
import {getDecodePlan} from './decode-plan.js';
import {getSourceFusionPlan} from './source-fusion.js';
import {executionCodeStatistics} from './code-version.js';
import {methodGenericParameters} from '@sharpforge/cil';
import {instantiatedMethod, captureGenericInstantiations} from './generics.js';

function* liveFrames(vm) {
  yield* vm.frames;
  for (const context of vm.scheduler?.contexts.values() ?? []) yield* context.frames;
}

function prepareCil(vm) {
  if (vm.report?.success !== true || !Array.isArray(vm.report.methods)) throw new TypeError('Missing successful CIL verification');
  const verified = new Set(vm.report.methods);
  const methods = new Set(), plans = new Set(), contexts = new Map();
  const prepare = method => {
    if (!verified.has(method.token)) throw new TypeError('Preparation requires a verified method');
    if (plans.has(method)) return;
    getDecodePlan(vm, method);
    plans.add(method);
    methods.add(method.token);
  };
  const canonical = (token, owner = null, arguments_ = []) => {
    const method = instantiatedMethod(vm, token, owner, arguments_);
    const context = [token, method.genericIdentity, [...method.methodArguments]];
    contexts.set(JSON.stringify(context), context);
    prepare(method);
    return method;
  };
  // Calls always use instantiatedMethod, even for nongeneric MethodDefs. Decoding
  // inspector.getMethod would prepare a different object that execution never uses.
  for (const token of verified) {
    const method = vm.inspector.getMethod(token);
    if (!(method.signature.genericArity ?? 0) && !methodGenericParameters(vm.inspector, method.ownerToken).length) canonical(token);
  }
  // These tuples include closed declaring types and method arguments. An open
  // generic definition cannot be prepared with an invented or incomplete context.
  for (const [token, owner, arguments_] of captureGenericInstantiations(vm)) {
    if (verified.has(token)) canonical(token, owner, arguments_);
  }
  for (const frame of liveFrames(vm)) {
    const method = frame.method;
    if (!method || !verified.has(method.token)) throw new TypeError('Invalid live CIL preparation frame');
    const current = canonical(method.token, frame.genericIdentity ?? method.genericIdentity ?? null,
      frame.methodArguments ?? method.methodArguments ?? []);
    if (current.instructions !== method.instructions) throw new TypeError('Live method belongs to another code generation');
    // In-memory restore rebuilds the generic cache but preserves captured method
    // objects in frames. Decode both identities without replacing debugger state.
    prepare(method);
  }
  return {methods: methods.size, plans: plans.size, contexts: [...contexts.values()],
    deferredMethods: [...verified].filter(token => !methods.has(token))};
}

/** Prepare derived interpreter plans without executing IL, starting tasks, or compiling the optional Wasm tier. */
export function prepareExecution(vm) {
  if (!['ready', 'running', 'paused'].includes(vm?.state)) throw new TypeError('Preparation requires a live verified VM');
  let details;
  if (vm instanceof CilVirtualMachine) {
    details = prepareCil(vm);
  } else if (vm instanceof VirtualMachine) {
    if (vm.options.sourceFusion === false) return {status: 'unsupported', reason: 'Source fusion preparation is disabled'};
    for (const method of vm.image.methods) getSourceFusionPlan(vm, method);
    details = {methods: vm.image.methods.length, plans: vm.image.methods.length};
  } else throw new TypeError('Preparation requires a SharpForge VM');
  return {status: 'prepared', engine: vm instanceof CilVirtualMachine ? 'cil' : 'source', ...details,
    statistics: executionCodeStatistics(vm)};
}
