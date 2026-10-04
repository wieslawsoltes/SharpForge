/** Calling conventions are part of a function pointer's type, independent of source ordering. */

export const knownFunctionPointerConventions = Object.freeze([
  'Cdecl', 'Stdcall', 'Thiscall', 'Fastcall', 'SuppressGCTransition', 'MemberFunction', 'Swift',
]);

/** Canonical, immutable convention names. Repeated marker types do not change the calling convention. */
export function normalizeCallingConventions(names = []) {
  return Object.freeze([...new Set(names)].sort());
}

/** True when canonical signatures select the same managed/unmanaged convention and marker set, in O(marker count). */
export function sameCallingConvention(left, right) {
  if (left.callingConvention !== right.callingConvention) return false;
  const first = left.unmanagedConventions ?? [];
  const second = right.unmanagedConventions ?? [];
  return first.length === second.length && first.every((name, index) => name === second[index]);
}
