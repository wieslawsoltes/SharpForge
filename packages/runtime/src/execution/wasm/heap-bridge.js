const allocations = new Set(['newarr', 'newobj', 'box', 'ldstr']);
const fields = new Set(['ldfld', 'stfld', 'ldsfld', 'stsfld']);

/** Imported heap operations retain the interpreter's allocation, covariance and write-barrier paths. */
export function wasmHostImport(name) {
  if (allocations.has(name)) return 'allocate';
  if (fields.has(name)) return 'field';
  if (name.startsWith('ldelem') || name.startsWith('stelem') || name === 'ldlen') return 'array';
  if (name === 'call' || name === 'callvirt' || name === 'ret') return 'call';
  return 'host';
}

/** Every bridge call starts with operands in the ordinary rooted CIL frame. */
export function invokeWasmHost(context, pc, kind) {
  if (!context.active || !Number.isInteger(pc) || pc < 0 || pc >= context.plan.instructions.length) {
    throw new Error('Wasm host import outside its active instruction');
  }
  const instruction = context.plan.instructions[pc];
  if (wasmHostImport(instruction.name) !== kind) throw new Error('Wasm host import category mismatch');
  // Authoritative handlers preserve class initialization retry PCs, field/array
  // barriers, pinned allocation operands, volatile fences and onWrite callbacks.
  context.plan.handlers[pc](context.vm, context.frame, instruction);
}
