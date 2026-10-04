import {ManagedFault} from '../heap.js';

/** Preserve live outer callback storage while another native invocation temporarily owns the interpreter. */
export function retainCallbackFrames(scheduler, execution) {
  const scopes = scheduler.callbackScopes ??= [];
  if (scopes.length >= 128) throw new ManagedFault('ExecutionLimitException', 'Nested UI callback limit exceeded');
  const scope = {frames: execution.frames, stack: execution.stack};
  scopes.push(scope);
  return () => {
    const index = scopes.lastIndexOf(scope);
    if (index >= 0) scopes.splice(index, 1);
  };
}
