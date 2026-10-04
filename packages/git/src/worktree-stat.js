/** Match a content revision only when the adapter can rule out a racy timestamp. */
export function sameWorktreeStat(left, right) {
  if (!left || !right) return false;
  if (left.revision !== undefined || right.revision !== undefined) {
    return left.revision !== undefined && left.revision === right.revision;
  }
  if (!left.cacheable || !right.cacheable) return false;
  const before = left.identity;
  const after = right.identity;
  return !!before && !!after && before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.mode === after.mode
    && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}
