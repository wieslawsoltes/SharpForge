const MAX_BINARY_BYTES = 64 * 1024;

/** Target limits can only lower the fixed per-case byte envelope. Invalid harness configuration throws. */
export function binaryLimits(input, context) {
  if (!(input instanceof Uint8Array)) throw new TypeError('Binary fuzz input must be a Uint8Array');
  for (const key of ['maxInputBytes', 'maxOutputBytes']) {
    if (!Number.isSafeInteger(context?.[key]) || context[key] < 1) {
      throw new RangeError(`Binary fuzz ${key} must be a positive safe integer`);
    }
  }
  return {
    maxInputBytes: Math.min(context.maxInputBytes, MAX_BINARY_BYTES),
    maxOutputBytes: Math.min(context.maxOutputBytes, MAX_BINARY_BYTES),
    signal: context.signal,
  };
}

export function binaryRejection(code, detail) {
  return { status: 'rejected', code, ...(detail ? { detail: String(detail).slice(0, 240) } : {}) };
}

/** Synchronous readers check cancellation at entry; the disposable harness child supplies the wall-clock limit. */
export function binaryAdmission(input, limits) {
  if (limits.signal?.aborted) return binaryRejection('FUZZ_CANCELLED');
  if (input.byteLength > limits.maxInputBytes) return binaryRejection('FUZZ_INPUT_LIMIT');
  return null;
}

/** Only the owning parser's documented validation error class is a controlled rejection. */
export function binaryFailure(error, ErrorClass, code) {
  if (!(error instanceof ErrorClass)) throw error;
  return binaryRejection(code, error.message);
}

/** Bound JSON depth, graph nodes and typed-array expansion before invoking a recursive reviver. */
export function binaryJsonBudget(root, { maxTypedBytes = 0 } = {}) {
  const pending = [{ value: root, depth: 0 }];
  let nodes = 0;
  let typedBytes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop();
    if (++nodes > 8192 || depth > 32) return binaryRejection('FUZZ_JSON_LIMIT');
    if (value === null || typeof value !== 'object') continue;
    if (maxTypedBytes && Object.hasOwn(value, '$int32') && value.$int32) {
      if (!Array.isArray(value.$int32)) return binaryRejection('FUZZ_TYPED_ARRAY_SHAPE');
      typedBytes += value.$int32.length * Int32Array.BYTES_PER_ELEMENT;
      if (typedBytes > maxTypedBytes) return binaryRejection('FUZZ_OUTPUT_LIMIT');
    }
    const children = Object.values(value);
    if (nodes + pending.length + children.length > 8192) return binaryRejection('FUZZ_JSON_LIMIT');
    for (const child of children) pending.push({ value: child, depth: depth + 1 });
  }
  return null;
}
