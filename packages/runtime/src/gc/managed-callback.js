import {ManagedFault} from './fault.js';
import {visitVMRoots} from './roots.js';
import {verifyManagedEntry} from './verified-entry.js';
import {boundDelegateCall} from '../execution/delegate-targets.js';

const controlFields = ['frames', 'stack', 'currentPoint', 'pendingFault', 'fault', 'returnValue', 'exitCode', 'sourcePause', 'state'];

function callbackTarget(vm, delegate, args) {
  const record = vm.heap.get(delegate);
  if (record.kind === 'delegate') {
    const target = boundDelegateCall(vm, delegate, args);
    return {methodId: target.method, arguments: target.arguments};
  }
  const methods = vm.inspector ? [...vm.inspector.methods.values()] : vm.image.methods;
  const invoke = methods.find(definition => {
    if (definition.owner !== record.type || definition.name !== 'Invoke') return false;
    // Inspector declaration rows deliberately omit decoded signatures; load only
    // matching candidates before checking the lowered delegate's static ABI.
    const method = vm.inspector ? vm.inspector.getMethod(definition.token) : definition;
    return (method.signature?.isStatic ?? method.isStatic) &&
      (method.signature?.parameters?.length ?? method.parameters?.length) === args.length + 1;
  });
  const fields = vm.image?.types.find(type => type.name === record.type)?.fields ??
    (vm.inspector ? [...vm.inspector.fields.values()].filter(field => field.owner === record.type) : []);
  if (record.kind !== 'object' || !invoke || !fields.some(field => field.name === 'method') || !fields.some(field => field.name === 'next')) {
    throw new ManagedFault('ArgumentException', 'A managed delegate or verified lowered delegate is required');
  }
  return {methodId: invoke.token ?? invoke.id, arguments: [delegate, ...args]};
}

/** Execute a managed delegate synchronously with an instruction bound and explicit interrupted roots. */
export function invokeManagedCallback(vm, delegate, args, instructionBudget = 100000) {
  const target = callbackTarget(vm, delegate, args);
  return invokeManagedMethod(vm, target, instructionBudget);
}

export function invokeManagedInstance(vm, reference, name, args = []) {
  const record = vm.heap.get(reference);
  const methods = vm.inspector ? [...vm.inspector.methods.values()] : vm.image.methods;
  for (let table = record.methodTable; table; table = table.base) {
    const candidate = methods.find(method => method.owner === table.name && method.name === name);
    if (!candidate) continue;
    const method = vm.inspector ? vm.inspector.getMethod(candidate.token) : candidate;
    if (method.signature?.isStatic ?? method.isStatic) continue;
    return invokeManagedMethod(vm, {methodId: method.token ?? method.id, arguments: [reference, ...args]}, 100000);
  }
  throw new ManagedFault('MissingMethodException', `${record.type}::${name}`);
}

function invokeManagedMethod(vm, target, instructionBudget) {
  verifyManagedEntry(vm, target.methodId);
  const roots = [...target.arguments];
  visitVMRoots(vm, value => roots.push(value));
  const saved = {};
  for (const field of controlFields) if (Object.hasOwn(vm, field)) saved[field] = vm[field];
  const suppressed = vm.scheduler.suppressed;
  const executing = vm.gcRuntime.executingFinalizer;
  const limit = vm.options.maxInstructions;
  const onException = vm.onException;
  vm.scheduler.suppressed = true;
  vm.gcRuntime.executingFinalizer = true;
  vm.onException = null;
  vm.options.maxInstructions = Math.min(limit, vm.instructions + instructionBudget);
  try {
    return vm.heap.withRoots(roots, () => {
      vm.frames = [];
      if (vm.image) vm.stack = [];
      vm.fault = null;
      vm.pendingFault = null;
      vm.returnValue = null;
      vm.state = 'running';
      vm.call(target.methodId, target.arguments);
      while (vm.state === 'running' && vm.frames.length) vm.runSlice({instructionBudget: 128, timeBudgetMs: Infinity});
      if (vm.state === 'faulted') throw vm.fault;
      if (vm.state === 'waiting') throw new ManagedFault('InvalidOperationException', 'A synchronous managed callback cannot await');
      return vm.returnValue;
    });
  } finally {
    for (const field of controlFields) {
      if (Object.hasOwn(saved, field)) vm[field] = saved[field];
      else delete vm[field];
    }
    vm.scheduler.suppressed = suppressed;
    vm.gcRuntime.executingFinalizer = executing;
    vm.options.maxInstructions = limit;
    vm.onException = onException;
  }
}
