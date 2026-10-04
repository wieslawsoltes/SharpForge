/** Managed identities are slot/generation pairs, never host object addresses. */
export function isReference(value) {
  return value !== null && typeof value === 'object'
    && Number.isSafeInteger(value.h) && value.h >= 0
    && Number.isSafeInteger(value.g) && value.g > 0;
}

export function sameReference(left, right) {
  return left === right || isReference(left) && isReference(right)
    && left.h === right.h && left.g === right.g;
}

/** The owner of a managed interior address is the reference that must be rooted. */
export function rootReference(value) {
  for (let depth = 0; depth < 16 && value; depth++) {
    if (isReference(value)) return value;
    if (value.byref) value = value.owner;
    else if (value instanceof Error) value = value.reference;
    else return null;
  }
  return null;
}
