const noArguments = Object.freeze([]);

/** Run host code and optional result inspection within one synchronous, platform-owned boundary. */
export function invokeSynchronousHostCallback(platform, callback, receiver, inspectResult) {
  const depth = platform.synchronousHostCallbackDepth;
  platform.synchronousHostCallbackDepth = depth + 1;
  try {
    const result = Reflect.apply(callback, receiver, noArguments);
    if (inspectResult) inspectResult(result);
    return result;
  } finally {
    platform.synchronousHostCallbackDepth = depth;
  }
}

/** A snapshot cannot capture the pending JavaScript continuation after a synchronous host call. */
export function requireHostCallbackBoundary(platform) {
  if (platform.synchronousHostCallbackDepth > 0) {
    throw new TypeError('Execution snapshot and restore are unavailable during synchronous host callbacks');
  }
}
