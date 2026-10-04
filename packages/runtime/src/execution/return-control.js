import {
  continueDelegate
} from './delegate-invocations.js';
import {
  continueExceptionEvent
} from './exception-events.js';
import {
  markUnhandled
} from './unhandled.js';
import {continueObjectValue} from './object-value-operation.js';
import {requireObjectStringResult} from './object-string-result.js';

/** Null preserves the caller's value; retired metadata stays alive until continuation delivery finishes. */
export function continueControlReturn(vm, frame, value) {
  if (frame.objectStringReturn) requireObjectStringResult(vm, value);
  // Read each continuation only at its turn: validation and managed callbacks can install later work.
  const objectState = frame.objectValueContinuation;
  const object = objectState ? continueObjectValue(vm, frame, value, objectState) : null;
  if (object?.handled) return object;
  if (object) value = object.value;
  const delegateState = frame.delegateContinuation;
  if (delegateState && continueDelegate(vm, frame, value, delegateState).continued) return {
    handled: true
  };
  const eventState = frame.exceptionEventContinuation;
  if (!eventState) return object;
  const event = continueExceptionEvent(vm, frame, eventState);
  if (!event.continued) {
    if (event.phase === 'unhandled') markUnhandled(vm, event.fault);
    else if (vm.inspector) vm.raise(event.fault);
    else vm.handleFault(event.fault);
  }
  return {
    handled: true
  };
}
