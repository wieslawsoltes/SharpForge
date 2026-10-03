import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { concatenateBytes } from '../hash/bytes.js';

/** Capability construction only; decoding failures must not silently retry another backend. */
export function nativeCodec(kind, backend) {
  if (backend === 'portable') return null;
  if (!['native', 'auto'].includes(backend)) throw new TypeError('Compression backend must be auto, native or portable');
  const Codec = kind === 'inflate' ? globalThis.DecompressionStream : globalThis.CompressionStream;
  if (!Codec) {
    if (backend === 'native') throw new GitError('Unsupported', 'Platform compression streams are unavailable');
    return null;
  }
  try {
    return new Codec('deflate');
  } catch (error) {
    if (backend !== 'auto' || !(error instanceof TypeError)) throw error;
    return null;
  }
}

/** Feed bounded chunks and enforce the output cap while reading, before aggregate allocation. */
export async function transformBytes(bytes, codec, { signal, maxOutputBytes }) {
  let offset = 0;
  const input = new ReadableStream({
    pull(controller) {
      checkCancelled(signal);
      if (offset === bytes.length) return controller.close();
      const end = Math.min(bytes.length, offset + 16384);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    }
  });
  const reader = input.pipeThrough(codec).getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      checkCancelled(signal);
      const { value, done } = await reader.read();
      if (done) break;
      length = checkLimit(length + value.length, maxOutputBytes, 'Compression output size');
      chunks.push(value);
    }
  } catch (error) {
    const cancellation = await Promise.allSettled([reader.cancel(error)]);
    if (error instanceof GitError) throw error;
    const failedCancellation = cancellation[0].status === 'rejected' ? cancellation[0].reason : null;
    throw new GitError('Corrupt', 'Invalid platform compression stream', {
      reason: error.message,
      cancellation: failedCancellation && failedCancellation !== error ? failedCancellation.message : undefined
    });
  } finally {
    reader.releaseLock();
  }
  checkCancelled(signal);
  return concatenateBytes(chunks, length);
}
