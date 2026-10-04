import {verifyCilAssembly} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {retainCallbackFrames} from './callback-frames.js';
import {popPooledFrame} from './frame-retirement.js';
import {flushFramePool} from './frame-pool.js';
import {leaveCilMethod} from './cil-method-events.js';
import {leaveSourceMethod} from './source-runtime-events.js';
import {abandonInitialization} from './static-init.js';
import {verifiedMethod} from './token-cache.js';
import {cilAdmissionOptions} from './cil-admission.js';

const controlFields = ['frames', 'stack', 'state', 'sourcePause', 'currentPoint', 'pendingFault',
  'fault', 'returnValue', 'exitCode', 'onException'];
export const SYNCHRONOUS_CALL_CANCELED = Symbol('synchronous call canceled');

function requireMethod(vm, methodId, args) {
  const method = vm.inspector ? vm.inspector.getMethod(methodId) : vm.image.methods[methodId];
  if (!method) throw new ManagedFault('MissingMethodException', 'The synchronous callback method is unavailable');
  const signature = method.signature ?? method;
  if (method.isAsync || signature.parameters.length !== args.length) {
    throw new ManagedFault('ArgumentException', 'The synchronous callback signature does not match');
  }
  if (vm.inspector && !verifiedMethod(vm, methodId)) {
    const roots = [...new Set([...vm.report.methods, methodId])];
    // Use the same structural limits as initial admission, before adding callback roots.
    const report = verifyCilAssembly(vm.inspector, {...cilAdmissionOptions(vm.scheduler.options),
      methodToken: vm.report.entryPoint, additionalMethodTokens: roots});
    if (!report.success) throw new ManagedFault('InvalidProgramException', report.issues.map(issue => issue.message).join('; '));
    vm.report = report;
  }
  return signature;
}

function limitFault() {
  const fault = new ManagedFault('ExecutionLimitException', 'Synchronous callback instruction budget exceeded');
  fault.fatal = true;
  return fault;
}

function preserveInitializationCause(vm, failure) {
  if (!(failure instanceof ManagedFault) || failure.name !== 'OutOfMemoryException') return;
  for (let index = vm.frames.length - 1; index >= 0; index--) {
    const frame = vm.frames[index];
    if (!frame.initializes) continue;
    const cause = vm.initialized.get(frame.initializes)?.fault ?? frame.pending?.error;
    if (!cause || cause === failure) continue;
    failure.initializationFailure = cause;
    return;
  }
}

function finishAbandonedFrames(vm, fault) {
  let failures = null;
  try {
    while (vm.frames.length) {
      const frame = vm.top;
      try {
        if (vm.inspector) {
          if (frame.initializes) {
            const errors = abandonInitialization(vm, frame, fault);
            if (errors) (failures ??= []).push(...errors);
          }
          leaveCilMethod(vm, frame, 'exception');
        } else leaveSourceMethod(vm, frame, 'exception');
      } catch (error) { (failures ??= []).push(error); }
      finally {
        try { if (vm.top === frame) popPooledFrame(vm); }
        catch (error) { (failures ??= []).push(error); }
      }
    }
  } finally {
    try { flushFramePool(vm); }
    catch (error) { (failures ??= []).push(error); }
  }
  return failures;
}

function evaluate(vm, methodId, values, maxInstructions, start, extra) {
  vm.call(methodId, values, extra);
  while (vm.frames.length && vm.state === 'running') {
    const remaining = maxInstructions - (vm.instructions - start);
    if (remaining <= 0) throw limitFault();
    vm.runSlice({instructionBudget: Math.min(128, remaining), timeBudgetMs: Infinity});
  }
  if (vm.state === 'faulted' || vm.pendingFault) throw vm.fault ?? vm.pendingFault;
  if (vm.frames.length || vm.state !== 'terminated') {
    throw new ManagedFault('InvalidOperationException', 'A synchronous callback cannot suspend execution');
  }
  return vm.returnValue;
}

/** Invoke a verified method synchronously; mutations commit and faults escape to the interrupted managed caller. */
export function invokeManagedMethod(platform, methodId, receiver, args, options = {}) {
  const {maxInstructions = 20000, roots = [], ...extra} = options;
  if (!Number.isSafeInteger(maxInstructions) || maxInstructions < 1) throw new RangeError('Invalid synchronous instruction budget');
  const vm = platform.vm, scheduler = vm.scheduler;
  const signature = requireMethod(vm, methodId, args);
  const oldFrames = vm.options.maxFrames, availableFrames = oldFrames - vm.frames.length;
  if (availableFrames < 1) {
    const fault = new ManagedFault('StackOverflowException', 'Managed callback call depth exceeded');
    fault.fatal = true;
    throw fault;
  }
  const saved = Object.fromEntries(controlFields.map(name => [name, vm[name]]));
  scheduler.ensure();
  if (!scheduler.suppressed) scheduler.save();
  const oldSuppressed = scheduler.suppressed, oldLimit = vm.options.maxInstructions, start = vm.instructions;
  const values = signature.isStatic ? args : [receiver, ...args];
  return vm.heap.withRoots([receiver?.owner, ...values, ...roots], () => {
    const lease = retainCallbackFrames(scheduler, saved);
    let value, failure = null;
    try {
      vm.frames = [];
      if (!vm.inspector) vm.stack = [];
      vm.state = 'running';
      vm.sourcePause = false;
      vm.currentPoint = vm.pendingFault = vm.fault = vm.returnValue = vm.onException = null;
      vm.exitCode = 0;
      scheduler.suppressed = true;
      vm.options.maxInstructions = Math.min(oldLimit, start + maxInstructions);
      vm.options.maxFrames = availableFrames;
      value = evaluate(vm, methodId, values, maxInstructions, start, extra);
    } catch (error) {
      failure = error;
      preserveInitializationCause(vm, failure);
    } finally {
      const errors = finishAbandonedFrames(vm, failure);
      for (const name of controlFields) {
        if (lease.scope.canceled && name !== 'onException') continue;
        if (saved[name] === undefined) delete vm[name];
        else vm[name] = saved[name];
      }
      scheduler.suppressed = oldSuppressed;
      vm.options.maxInstructions = oldLimit;
      vm.options.maxFrames = oldFrames;
      lease.release();
      if (!lease.scope.canceled) scheduler.save();
      if (errors?.length) {
        failure ??= errors.shift();
        if (errors.length) (failure.cleanupErrors ??= []).push(...errors);
      }
    }
    if (failure) throw failure;
    return lease.scope.canceled ? SYNCHRONOUS_CALL_CANCELED : value;
  });
}
