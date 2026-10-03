// Code-generation metadata is shared by all frames and does not root a VM/heap.
const plans = new WeakMap();
export function methodOffsets(method) {
  const cached = plans.get(method);
  if (cached?.instructions === method.instructions) return cached.offsets;
  const offsets = new Map(method.instructions.map((instruction, index) => [instruction.offset, index]));
  plans.set(method, {instructions: method.instructions, offsets});
  return offsets;
}
