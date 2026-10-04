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

/** Retired call metadata remains alive until continuations deliver their final result. */
export function continueControlReturn(vm, frame, value) {
  if (frame.objectStringReturn) requireObjectStringResult(vm, value);
  const object = continueObjectValue(vm, frame, value);
  if (object.handled) return object;
  value = object.value;
  const delegate = continueDelegate(vm, frame, value);
  if (delegate.continued) return {
    handled: true
  };
  const event = continueExceptionEvent(vm, frame);
  if (!event) return {
    handled: false,
    value: delegate.result
  };
  if (!event.continued) {
    if (event.phase === 'unhandled') markUnhandled(vm, event.fault);
    else if (vm.inspector) vm.raise(event.fault);
    else vm.handleFault(event.fault);
  }
  return {
    handled: true
  };
}
