/** Calling conventions are part of a function pointer's type, independent of source ordering. */

/** Canonical, immutable convention names. Repeated marker types do not change the calling convention. */
export function normalizeCallingConventions(names = []) {
  return Object.freeze([...new Set(names)].sort());
}

/** True when two function-pointer signatures select the same managed/unmanaged convention and marker set. */
export function sameCallingConvention(left, right) {
  if (left.callingConvention !== right.callingConvention) return false;
  const first = left.unmanagedConventions ?? [];
  const second = right.unmanagedConventions ?? [];
  return first.length === second.length && first.every(name => second.includes(name));
}
