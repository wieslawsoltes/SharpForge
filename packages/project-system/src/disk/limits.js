export const DEFAULT_DISK_LIMITS = Object.freeze({
  maxFiles: 20000, maxFileBytes: 2_000_000, maxAssemblyBytes: 64 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024
});

/** Limits are caller-owned and immutable once a workspace has been opened. */
export function diskLimits(options = {}) {
  const limits = Object.fromEntries(Object.keys(DEFAULT_DISK_LIMITS).map(key => [key,
    Object.hasOwn(options, key) ? options[key] : DEFAULT_DISK_LIMITS[key]]));
  for (const key of Object.keys(DEFAULT_DISK_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) throw new RangeError(`Invalid disk workspace limit ${key}`);
  }
  return Object.freeze(limits);
}

/** Compute the encoding size without allocating a second copy of a large source file. */
export function encodedLength(record, text = record.text) {
  if (typeof text !== 'string') return record.bytes?.byteLength ?? 0;
  if (record.bytes && text === record.originalText) return record.bytes.byteLength;
  if (record.encoding === 'utf-16le' || record.encoding === 'utf-16be') return text.length * 2 + (record.bom ? 2 : 0);
  let length = record.bom ? 3 : 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) length++;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
      && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      length += 4;
      index++;
    } else length += 3;
  }
  return length;
}
