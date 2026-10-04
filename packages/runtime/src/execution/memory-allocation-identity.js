function sameOwner(left, right) {
  return left === right || left?.h !== undefined && right?.h !== undefined && left.h === right.h && left.g === right.g;
}

function sameLocation(left, right) {
  if (!left || !right || left.kind !== right.kind || left.index !== right.index || !sameOwner(left.owner, right.owner)) return false;
  if (['local', 'arg'].includes(left.kind) && left.frameId !== right.frameId) return false;
  return left.path.length === right.path.length && left.path.every((index, position) => index === right.path[position]);
}

/** Independently created addresses for the same live storage compare by location, never wrapper identity. */
export function sameMemoryAllocation(left, right) {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'reinterpret') return sameLocation(left.source, right.source);
  if (left.frameId !== right.frameId) return false;
  if (left.kind === 'stack') return left.regionId === right.regionId;
  return left.kind === 'pinned' && left.leaseId === right.leaseId && left.localIndex === right.localIndex &&
    sameOwner(left.owner, right.owner);
}
