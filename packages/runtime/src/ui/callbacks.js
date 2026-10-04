import {ManagedFault, isReference} from '../heap.js';
import {verifyCilAssembly, mergeVerifiedStackReports} from '@sharpforge/cil';
import {managedDelegateTarget} from './delegate-target.js';
import {retainCallbackFrames} from '../execution/callback-frames.js';
import {popPooledFrame} from '../execution/frame-retirement.js';
import {flushFramePool} from '../execution/frame-pool.js';
import {leaveCilMethod} from '../execution/cil-method-events.js';

const controlFields = [
  'frames', 'stack', 'state', 'sourcePause', 'currentPoint', 'pendingFault', 'fault', 'returnValue', 'exitCode'
];

/** Aborted callbacks own their frames even when normal ret/exception unwind did not run. */
function retireCallbackFrames(vm) {
  let failure;
  while (vm.frames.length) {
    try { if (vm.inspector) leaveCilMethod(vm, vm.top, 'canceled'); }
    catch (error) { failure ??= error; }
    finally { popPooledFrame(vm); }
  }
  flushFramePool(vm);
  if (failure) throw failure;
}

/** Invoke a verified managed callback without leaving a suspended scheduler context. */
export function invokeManagedCallback(platform, callback, args, {maxInstructions = 20000} = {}) {
  if (typeof callback === 'function') return callback(...args);
  const target = managedDelegateTarget(platform.vm, callback, args);
  if (target.native) return platform.ui.bindingServices.events.invokeDelegate(callback, args).value;
  const method = platform.vm.inspector ? platform.vm.inspector.getMethod(target.method).signature : platform.vm.image.methods[target.method];
  return invokeManagedMethod(platform, target.method, method.isStatic ? null : target.values[0],
    method.isStatic ? target.values : target.values.slice(1), {maxInstructions, roots: [callback]});
}

/** Invoke a verified instance/static method while preserving the interrupted execution context. */
export function invokeManagedMethod(platform, methodId, receiver, args, {maxInstructions = 20000, roots = []} = {}) {
  const vm = platform.vm;
  if (vm.inspector && !vm.report.methods.includes(methodId)) {
    const report = verifyCilAssembly(vm.inspector, {methodToken: methodId});
    if (!report.success) throw new ManagedFault('InvalidProgramException', report.issues.map(issue => issue.message).join('; '));
    vm.report = mergeVerifiedStackReports(vm.inspector, vm.report, report);
  }
  const method = vm.inspector ? vm.inspector.getMethod(methodId) : vm.image.methods[methodId];
  if (!method) throw new ManagedFault('MissingMethodException', 'The UI callback method is unavailable');
  const signature = vm.inspector ? method.signature : method;
  if (method.isAsync || signature.parameters.length !== args.length) {
    throw new ManagedFault('ArgumentException', 'The synchronous callback signature does not match');
  }
  const saved = Object.fromEntries(controlFields.map(name => [name, vm[name]]));
  if (!vm.scheduler.suppressed) { vm.scheduler.ensure(); vm.scheduler.save(); }
  const oldSuppressed = vm.scheduler.suppressed;
  const oldLimit = vm.options.maxInstructions;
  const start = vm.instructions;
  const retained = [...vm.roots(), receiver, ...roots, ...args];
  return vm.heap.withRoots(retained, () => {
    const releaseFrames = retainCallbackFrames(vm.scheduler, saved);
    try {
      vm.frames = [];
      if (!vm.inspector) vm.stack = [];
      vm.state = 'running';
      vm.sourcePause = false;
      vm.pendingFault = null;
      vm.fault = null;
      vm.returnValue = null;
      vm.scheduler.suppressed = true;
      vm.options.maxInstructions = Math.min(oldLimit, start + maxInstructions);
      const values = signature.isStatic ? args : [receiver, ...args];
      vm.call(methodId, values);
      if (vm.inspector) vm.ensureInitialized(method.ownerToken);
      while (vm.frames.length && vm.state === 'running') {
        if (vm.instructions - start >= maxInstructions) {
          throw new ManagedFault('ExecutionLimitException', 'Synchronous UI callback instruction budget exceeded');
        }
        vm.runSlice({instructionBudget: Math.min(128, maxInstructions - (vm.instructions - start)), timeBudgetMs: 4});
      }
      if (vm.state === 'faulted' || vm.pendingFault) throw vm.fault ?? vm.pendingFault;
      if (vm.frames.length || vm.state === 'waiting' || vm.state === 'paused') {
        throw new ManagedFault('InvalidOperationException', 'A synchronous UI callback cannot suspend execution');
      }
      return vm.returnValue;
    } finally {
      try { retireCallbackFrames(vm); }
      finally {
        for (const name of controlFields) {
          if (saved[name] === undefined) delete vm[name];
          else vm[name] = saved[name];
        }
        vm.scheduler.suppressed = oldSuppressed;
        vm.options.maxInstructions = oldLimit;
        releaseFrames();
      }
    }
  });
}
