import { GitError, checkCancelled, checkLimit } from '../errors.js';

/** Adapt byte arrays, ReadableStreams and async iterables without retaining the complete response. */
export async function* byteChunks(source, { signal } = {}) {
  checkCancelled(signal);
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    yield source instanceof Uint8Array ? source : new Uint8Array(source);
    return;
  }
  if (source?.body) source = source.body;
  if (source?.getReader) {
    const reader = source.getReader();
    let complete = false;
    try {
      while (true) {
        checkCancelled(signal);
        const result = await reader.read();
        if (result.done) { complete = true; break; }
        yield result.value;
      }
    } finally {
      try { if (!complete) await reader.cancel(); }
      finally { reader.releaseLock(); }
    }
    return;
  }
  if (!source?.[Symbol.asyncIterator] && !source?.[Symbol.iterator]) {
    throw new GitError('Corrupt', 'Expected a byte stream');
  }
  for await (const chunk of source) {
    checkCancelled(signal);
    if (!(chunk instanceof Uint8Array)) throw new GitError('Corrupt', 'Stream yielded non-byte data');
    yield chunk;
  }
}

/** Concatenate a bounded set of bytes. The caller explicitly controls the allocation limit. */
export function concatBytes(chunks, maximum = 256 * 1024 * 1024) {
  const size = chunks.reduce((sum, item) => checkLimit(sum + item.length, maximum, 'Byte buffer'), 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** Collect only small protocol metadata; pack consumers should iterate the response instead. */
export async function collectBytes(source, { maximum = 16 * 1024 * 1024, signal } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of byteChunks(source, { signal })) {
    size = checkLimit(size + chunk.length, maximum, 'Response bytes');
    chunks.push(chunk);
  }
  return concatBytes(chunks, maximum);
}

export const encodeText = value => new TextEncoder().encode(value);
export function decodeText(value) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(value); }
  catch { throw new GitError('Corrupt', 'Protocol text is not valid UTF-8'); }
}

/** Bound and reject protocol fields before putting caller data into a line-oriented message. */
export function protocolField(value, label = 'Protocol field') {
  if (typeof value !== 'string' || !value.length || /[\x00-\x20\x7f]/.test(value) || value.length > 4096) {
    throw new GitError('Unsafe', `${label} is invalid`);
  }
  return value;
}
