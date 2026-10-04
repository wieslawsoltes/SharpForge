const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const inputCeiling = 64 * 1024;
const outputCeiling = 256 * 1024;

/** Adapter-owned validation failure; parser bugs and cancellation never use this type. */
export class TextTargetRejection extends Error {
  constructor(code) {
    super(code);
    this.name = 'TextTargetRejection';
    this.code = code;
  }
}

function limit(value, fallback, name) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid fuzz ${name}`);
  return Math.min(value, fallback);
}

/** Encode a small, locally authored seed. Each call owns its returned bytes. */
export function textSeed(name, source) {
  return { name, input: encoder.encode(source) };
}

/** Decode strict UTF-8; only the decoder's documented encoding failure is rejected. */
export function decodeText(input) {
  try {
    return decoder.decode(input);
  } catch (error) {
    if (error instanceof TypeError && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') {
      throw new TextTargetRejection('FUZZ_UTF8');
    }
    throw error;
  }
}

/** JSON.parse is isolated so unrelated SyntaxErrors cannot be classified as input errors. */
export function parseTextJson(source) {
  try {
    return JSON.parse(source);
  } catch (error) {
    if (error instanceof SyntaxError) throw new TextTargetRejection('FUZZ_JSON');
    throw error;
  }
}

/** Check produced bytes/text without returning parsed input or credentials to the harness. */
export function checkTextOutput(value, limits) {
  const bytes = typeof value === 'string' ? encoder.encode(value).byteLength : value.byteLength;
  if (bytes > limits.maxOutputBytes) throw new TextTargetRejection('FUZZ_OUTPUT_LIMIT');
  return bytes;
}

/** Run one synchronous data parser with byte limits and explicit error classification. */
export function runTextTarget(input, context, operation, classifyError = () => null) {
  context ??= {};
  context.signal?.throwIfAborted();
  if (!(input instanceof Uint8Array)) throw new TypeError('Fuzz target input must be Uint8Array');
  const limits = {
    maxInputBytes: limit(context.maxInputBytes, inputCeiling, 'maxInputBytes'),
    maxOutputBytes: limit(context.maxOutputBytes, outputCeiling, 'maxOutputBytes'),
    signal: context.signal,
  };
  if (input.byteLength > limits.maxInputBytes) return { status: 'rejected', code: 'FUZZ_INPUT_LIMIT' };
  try {
    const result = operation(input, limits);
    context.signal?.throwIfAborted();
    return result ?? { status: 'accepted' };
  } catch (error) {
    context.signal?.throwIfAborted();
    if (error instanceof TextTargetRejection) return { status: 'rejected', code: error.code };
    const result = classifyError(error);
    if (result) return result;
    throw error;
  }
}
