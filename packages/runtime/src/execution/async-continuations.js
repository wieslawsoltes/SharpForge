import {asyncStateMachine} from '@sharpforge/cil';
import {ManagedFault} from './managed-fault.js';
import {enqueueManagedContext} from './managed-contexts.js';
import {verifiedMethod} from './token-cache.js';
export {visitAsyncTaskRoots, visitAsyncFrameRoots, cancelAsyncTask} from './async-continuation-roots.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);

function invokeContinuation(scheduler, continuation) {
  const vm = scheduler.vm;
  if (continuation.kind === 'delegate') {
    return scheduler.enqueue(continuation.receiver, [], {kind: 'async-continuation', propagateFault: false});
  }
  const machine = asyncStateMachine(vm.inspector, continuation.type);
  if (!machine || machine.moveNext !== continuation.method || !verifiedMethod(vm, machine.moveNext)) {
    throw new ManagedFault('InvalidProgramException', 'Unverified async continuation target');
  }
  const receiver = machine.valueType ? vm.address('box', 0, continuation.receiver) : continuation.receiver;
  return enqueueManagedContext(scheduler, {method: machine.moveNext, arguments: [receiver],
    extra: {genericIdentity: continuation.type.includes('<') ? continuation.type : null}}, {kind: 'async-continuation'});
}

/** Registration owns only frozen managed call data; no host function survives this boundary. */
export function registerAsyncContinuation(scheduler, task, continuation) {
  if (terminal.has(task.status)) {
    scheduler.vm.heap.withRoots([task.ref, continuation.receiver], () => invokeContinuation(scheduler, continuation));
    return;
  }
  task.continuations ??= [];
  if (task.continuations.length >= scheduler.maxContexts) {
    throw new ManagedFault('ExecutionLimitException', 'Managed async continuation limit exceeded');
  }
  task.continuations.push(continuation);
}

/** Detach before scheduling so completion, faults and snapshots cannot deliver a callback twice. */
export function completeAsyncContinuations(scheduler, task) {
  const pending = task.continuations;
  if (!pending?.length) return;
  task.continuations = [];
  // Detaching prevents duplicate delivery; the temporary roots keep every pending receiver alive while admission allocates.
  scheduler.vm.heap.withRoots([task.ref, ...pending.map(continuation => continuation.receiver)], () => {
    for (const continuation of pending) invokeContinuation(scheduler, continuation);
  });
}

/** A first struct suspension registers only after its managed SetStateMachine call returns. */
export function finishAsyncRegistration(vm, frame) {
  const registration = frame.asyncRegistration;
  // The caller has popped this frame, but deferred retirement keeps its data intact until the instruction ends.
  // Explicit pins also retain the registration if context admission or an allocation observer collects now.
  if (registration) vm.heap.withRoots([registration.task, registration.continuation.receiver], () =>
    registerAsyncContinuation(vm.scheduler, vm.scheduler.taskRecord(registration.task), registration.continuation));
}

export function copyAsyncTaskState(task) {
  return task.continuations ? {continuations: [...task.continuations]} : {};
}
