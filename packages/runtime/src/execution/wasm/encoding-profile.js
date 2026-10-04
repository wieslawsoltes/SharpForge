export const wasmValueTypes = Object.freeze({i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c});
export const wasmOperations = Object.freeze({
  i32: Object.freeze({add: 0x6a, sub: 0x6b, mul: 0x6c, and: 0x71, or: 0x72, xor: 0x73, shl: 0x74, shr: 0x75, 'shr.un': 0x76}),
  i64: Object.freeze({add: 0x7c, sub: 0x7d, mul: 0x7e, and: 0x83, or: 0x84, xor: 0x85, shl: 0x86, shr: 0x87, 'shr.un': 0x88}),
  f32: Object.freeze({add: 0x92, sub: 0x93, mul: 0x94}),
  f64: Object.freeze({add: 0xa0, sub: 0xa1, mul: 0xa2})
});

export const wasmImportSignatures = Object.freeze([
  ...Object.keys(wasmValueTypes).flatMap(type => [
    {name: `pop_${type}`, parameters: [], results: [type]},
    {name: `push_${type}`, parameters: [type], results: []}
  ]),
  {name: 'guard', parameters: ['i32'], results: ['i32']},
  ...['allocate', 'field', 'array', 'call', 'host'].map(name => ({name, parameters: ['i32'], results: []}))
].map(signature => Object.freeze({...signature,
  parameters: Object.freeze(signature.parameters), results: Object.freeze(signature.results)})));

const allocations = new Set(['newarr', 'newobj', 'box', 'ldstr']);
const fields = new Set(['ldfld', 'stfld', 'ldsfld', 'stsfld']);

export function wasmHostImport(name) {
  if (allocations.has(name)) return 'allocate';
  if (fields.has(name)) return 'field';
  if (name.startsWith('ldelem') || name.startsWith('stelem') || name === 'ldlen') return 'array';
  if (name === 'call' || name === 'callvirt' || name === 'ret') return 'call';
  return 'host';
}

/** Current i32 CIL arithmetic does not accept BigInt shift counts; retain its fault path. */
export function requiresHostArithmetic(instruction) {
  return instruction.kind === 'binary' && instruction.type === 'i32' && instruction.inputs[1] === 'i64';
}
