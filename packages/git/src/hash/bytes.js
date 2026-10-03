/** Accept byte-oriented input without copying; reject implicit string or numeric coercion. */
export function asBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('Expected byte data (Uint8Array, ArrayBuffer or an ArrayBuffer view)');
}

/** Join byte chunks after their aggregate size has been bounded by the caller. */
export function concatenateBytes(chunks, size = chunks.reduce((total, chunk) => total + chunk.length, 0)) {
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
