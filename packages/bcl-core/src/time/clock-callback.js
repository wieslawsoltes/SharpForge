const promiseThen = Promise.prototype.then;
const discardResult = () => undefined;
const promiseObservers = Object.freeze([discardResult, discardResult]);

function observeInvalidClockResult(value) {
  if (value === null || typeof value !== 'object') return;
  try {
    // Brand checking does not read a foreign thenable. Both handlers avoid forwarding a fulfilled payload.
    Reflect.apply(promiseThen, value, promiseObservers);
  } catch {
    // Non-Promises and unsupported throwing constructor/species hooks still fail timestamp validation.
  }
}

/** Inspect an invalid async result before leaving the callback boundary or applying cancellation policy. */
export function invokeStopwatchClock(platform, state) {
  const invoke = platform.bclHost.invokeSynchronousHostCallback;
  if (invoke) return invoke(platform, state.read, state, observeInvalidClockResult);
  const timestamp = state.read();
  observeInvalidClockResult(timestamp);
  return timestamp;
}
