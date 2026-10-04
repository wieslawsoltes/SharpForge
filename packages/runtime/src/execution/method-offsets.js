// Code-generation metadata is shared by all frames and does not root a VM/heap.
const plans = new WeakMap();
export function methodOffsets(method) {
  const cached = plans.get(method);
  if (cached?.instructions === method.instructions) return cached.offsets;
  const offsets = new Map(method.instructions.map((instruction, index) => [instruction.offset, index]));
  plans.set(method, {instructions: method.instructions, offsets, allocations: (cached?.allocations ?? 0) + 1});
  return offsets;
}

/** Number of offset-map allocations for this method identity, including replaced bodies. */
export function methodOffsetAllocations(method) {
  return plans.get(method)?.allocations ?? 0;
}
