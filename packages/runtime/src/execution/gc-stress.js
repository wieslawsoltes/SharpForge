/** Opt-in deterministic stress hook, called after each complete IL/IR instruction. */
export function collectAtInstruction(vm) {
  if (vm.options.gcStress === 'instruction') vm.heap.collect();
}
