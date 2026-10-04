/** Smallest single UTF-16 replacement between two explicit source strings. */
export function sourceChange(before, after) {
  let start = 0;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (start < oldEnd && start < newEnd && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  while (oldEnd > start && newEnd > start && before.charCodeAt(oldEnd - 1) === after.charCodeAt(newEnd - 1)) {
    oldEnd--;
    newEnd--;
  }
  return {start, length: oldEnd - start, newLength: newEnd - start};
}

/** Reject stale caller hints before passing them to the incremental lexer. */
export function validateSourceChange(before, after, change) {
  const {start, length, newLength} = change;
  if (![start, length, newLength].every(value => Number.isSafeInteger(value) && value >= 0) ||
      start + length > before.length || start + newLength > after.length ||
      before.length - length + newLength !== after.length ||
      before.slice(0, start) !== after.slice(0, start) ||
      before.slice(start + length) !== after.slice(start + newLength)) {
    throw new RangeError('Text change does not describe the source revision');
  }
  return change;
}
