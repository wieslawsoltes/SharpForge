/** Bound cold body-proof and control-flow work, including unreachable switch tables. */
export function wasmMetadataFits(method, workLimit) {
  let entries = method.instructions.length + (method.handlers?.length ?? 0);
  for (const instruction of method.instructions) {
    if (instruction.name === 'switch') entries += instruction.operand.length;
    if (entries > workLimit) return false;
  }
  return entries <= workLimit;
}
