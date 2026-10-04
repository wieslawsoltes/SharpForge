/** .NET 10 Char.IsWhiteSpace over UTF-16 code units; validated against the pinned exhaustive oracle. */
export function isWhiteSpace(unit) {
  return unit >= 0x09 && unit <= 0x0d || unit === 0x20 || unit === 0x85 || unit === 0xa0 || unit === 0x1680 ||
    unit >= 0x2000 && unit <= 0x200a || unit === 0x2028 || unit === 0x2029 || unit === 0x202f ||
    unit === 0x205f || unit === 0x3000;
}

export function isNullOrWhiteSpace(value) {
  if (value === null) return true;
  for (let index = 0; index < value.length; index++) {
    if (!isWhiteSpace(value.charCodeAt(index))) return false;
  }
  return true;
}

/** Trim the requested ends without treating the BOM as whitespace or disturbing surrogate code units. */
export function trimWhiteSpace(value, trimStart = true, trimEnd = true) {
  let start = 0;
  let end = value.length;
  if (trimStart) while (start < end && isWhiteSpace(value.charCodeAt(start))) start++;
  if (trimEnd) while (end > start && isWhiteSpace(value.charCodeAt(end - 1))) end--;
  return start === 0 && end === value.length ? value : value.slice(start, end);
}
