/** Inspect the bounded, verified prefix group of the currently executing call without mutable frame flags. */
export function callPrefix(frame, instruction, name) {
  const index = frame.pc - 1;
  if (frame.method.instructions[index] !== instruction) return null;
  for (let offset = index - 1; offset >= 0 && frame.method.instructions[offset].name.endsWith('.'); offset--) {
    const prefix = frame.method.instructions[offset];
    if (prefix.name === name) return prefix;
  }
  return null;
}

/** Return the operation owned by a verified contiguous prefix group. */
export function prefixedOperation(frame) {
  const instructions = frame.method.instructions;
  for (let index = frame.pc, count = 0; count < 64; index++, count++) {
    const instruction = instructions[index];
    if (!instruction || !instruction.name.endsWith('.')) return instruction ?? null;
  }
  return null;
}
