/** Return null when raw platform compression is unavailable; stream failures remain errors. */
export async function platformDeflate(bytes, { signal, maxOutputBytes = bytes.length * 2 + 65536 } = {}) {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new RangeError('Invalid compressed output budget');
  if (typeof CompressionStream !== 'function') return null;
  let compressor;
  try { compressor = new CompressionStream('deflate-raw'); }
  catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return null;
    throw error;
  }
  const source = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  const reader = source.pipeThrough(compressor, { signal }).getReader();
  const chunks = [];
  let total = 0;
  let failure;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxOutputBytes) throw new RangeError('Compressed output budget exceeded');
      chunks.push(value);
    }
    signal?.throwIfAborted();
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  } catch (error) { failure = error; throw error; }
  finally {
    try { await reader.cancel(); }
    catch (error) {
      if (failure) failure.cleanupError = error;
      else throw error;
    } finally { reader.releaseLock(); }
  }
}
