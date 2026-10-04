/** Conservative retained-data budget including linked native undo steps. Shared objects count once per entry. */
export function designerHistoryBytes(value, limit) {
  const seen = new Set();
  const pending = [value];
  let bytes = 0;
  while (pending.length && bytes <= limit) {
    const item = pending.pop();
    if (typeof item === 'string') bytes += item.length * 2 + 16;
    else if (!item || typeof item !== 'object') bytes += 8;
    else if (!seen.has(item)) {
      seen.add(item);
      bytes += 32;
      for (const key of Object.keys(item)) {
        bytes += key.length * 2 + 16;
        pending.push(item[key]);
      }
    }
  }
  return bytes;
}
