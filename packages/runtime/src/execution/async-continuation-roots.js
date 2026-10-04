/** Pending ABI registrations retain their task and stable state-machine box through collection. */
export function visitAsyncTaskRoots(task, visit) {
  if (task.asyncMachine) visit(task.asyncMachine.receiver);
  const continuations = task.continuations;
  if (continuations != null) {
    for (const continuation of continuations) visit(continuation.receiver);
  }
}

export function visitAsyncFrameRoots(frame, visit) {
  if (!frame.asyncRegistration) return;
  visit(frame.asyncRegistration.task);
  visit(frame.asyncRegistration.continuation.receiver);
}

/** VM stop drops future work; ordinary task cancellation still delivers its await continuations. */
export function cancelAsyncTask(task) {
  if (task.continuations) task.continuations = [];
  task.asyncMachine = null;
}
