/** An instruction boundary is a complete deopt map: no values remain resident in Wasm. */
export function wasmSafepoint(vm, frame = vm.top) {
  if (!frame) return null;
  return Object.freeze({frameId: frame.id, methodToken: frame.method.token, pc: frame.pc, ilOffset: frame.lastOffset,
    args: Object.freeze([...frame.args]), locals: Object.freeze([...frame.locals]), stack: Object.freeze([...frame.stack])});
}

/** Drop tier membership without replaying an instruction that may have performed effects. */
export function leaveWasmFrame(state, frameState, reason) {
  if (frameState.active) state.statistics.deoptimizations++;
  frameState.active = false;
  frameState.nextEntry = null;
  frameState.lastDeopt = reason;
}

/** Invoke native code only while the canonical CIL frame is the current frame. */
export function invokeWasmEntry(record, vm, frame, plan, index) {
  const context = record.context;
  if (context.active) throw new Error('Reentrant Wasm entry');
  context.vm = vm;
  context.frame = frame;
  context.plan = plan;
  context.active = true;
  try {
    record.entries[index]();
  } finally {
    // In particular, do not retain a returned frame while the T09 pool recycles it.
    context.active = false;
    context.frame = null;
    context.plan = null;
    context.vm = null;
  }
}
