import {fail, string} from '../host.js';

const owner = 'System.Text.StringBuilder';

/** Append typed builder equality after the ordered A07 predecessors; inherited Object.Equals stays separate. */
export function registerStringBuilderEqualityExtensions({member}) {
  member(owner, 'Equals', [owner], 'bool');
}

function equalChunks(platform, first, second, length) {
  const firstItems = platform.heap.get(platform.get(first, '$data')).data;
  const secondItems = platform.heap.get(platform.get(second, '$data')).data;
  let firstChunk = platform.get(first, '$count', 0);
  let secondChunk = platform.get(second, '$count', 0);
  let firstText = '';
  let secondText = '';
  let firstOffset = 0;
  let secondOffset = 0;
  let remaining = length;
  while (remaining > 0) {
    while (firstOffset === 0 && firstChunk > 0) {
      firstText = string(platform, firstItems[--firstChunk]);
      firstOffset = firstText.length;
    }
    while (secondOffset === 0 && secondChunk > 0) {
      secondText = string(platform, secondItems[--secondChunk]);
      secondOffset = secondText.length;
    }
    if (firstOffset === 0 || secondOffset === 0) {
      fail(platform, 'InvalidOperationException', 'StringBuilder chunks do not contain the declared text length');
    }
    const count = Math.min(remaining, firstOffset, secondOffset);
    for (let index = 0; index < count; index++) {
      if (firstText.charCodeAt(--firstOffset) !== secondText.charCodeAt(--secondOffset)) return false;
    }
    remaining -= count;
  }
  return true;
}

/** Compare rooted live UTF-16 chunks without flattening, copying or mutating either builder. */
export function builderEquals(platform, reference, other) {
  // The shared builder dispatcher validates the receiver before this null-source shortcut.
  if (other === null) return false;
  if (platform.record(other).type !== owner) fail(platform, 'InvalidCastException', 'A StringBuilder source is required');
  const length = platform.get(reference, '$length', 0);
  if (length !== platform.get(other, '$length', 0)) return false;
  if (length === 0 || reference.h === other.h && reference.g === other.g) return true;
  return equalChunks(platform, reference, other, length);
}
