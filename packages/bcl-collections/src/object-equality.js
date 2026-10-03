import {bclScalar, equal as scalarEqual} from '@sharpforge/bcl-core';

function boxedType(platform, value) {
  if (!platform.bclHost.isReference(value)) return null;
  const record = platform.heap.get(value);
  return record.kind === 'box' ? record.methodTable : null;
}

/** Default collection equality preserves a box's declared managed type before comparing its value. */
export function equal(platform, left, right) {
  if (left === right) return true;
  if (boxedType(platform, left) !== boxedType(platform, right)) return false;
  return scalarEqual(platform, left, right);
}

/** Index keys use the same box type distinction as equality, retaining NaN and signed-zero equivalence. */
export function keyOf(platform, value) {
  const type = boxedType(platform, value);
  const scalar = bclScalar(platform, value);
  let key;
  if (scalar === null) key = 'null';
  else if (platform.bclHost.isReference(scalar)) key = 'r:' + scalar.h + ':' + scalar.g;
  else key = typeof scalar + ':' + String(scalar);
  return type ? 'box:' + type.name + ':' + key : key;
}
