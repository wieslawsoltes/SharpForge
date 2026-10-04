/** Truncate at a UTF-16 boundary without retaining half of a surrogate pair. */
export function truncateUtf16(value, limit) {
  let end = Math.min(value.length, limit);
  const last = value.charCodeAt(end - 1);
  if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
  return value.slice(0, end);
}
