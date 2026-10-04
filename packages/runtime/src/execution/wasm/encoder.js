import {WasmBinary} from './binary.js';
import {wasmHostImport} from './heap-bridge.js';

const valueTypes = Object.freeze({i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c});
const operations = Object.freeze({
  i32: {add: 0x6a, sub: 0x6b, mul: 0x6c, and: 0x71, or: 0x72, xor: 0x73, shl: 0x74, shr: 0x75, 'shr.un': 0x76},
  i64: {add: 0x7c, sub: 0x7d, mul: 0x7e, and: 0x83, or: 0x84, xor: 0x85, shl: 0x86, shr: 0x87, 'shr.un': 0x88},
  f32: {add: 0x92, sub: 0x93, mul: 0x94},
  f64: {add: 0xa0, sub: 0xa1, mul: 0xa2},
});
export const wasmImportSignatures = Object.freeze([
  ...Object.keys(valueTypes).flatMap(type => [
    Object.freeze({name: `pop_${type}`, parameters: [], results: [type]}),
    Object.freeze({name: `push_${type}`, parameters: [type], results: []}),
  ]),
  ...['allocate', 'field', 'array', 'call', 'host'].map(name =>
    Object.freeze({name, parameters: ['i32'], results: []})),
]);

function constant(writer, type, value) {
  if (type === 'i32' || type === 'i64') {
    writer.byte(type === 'i32' ? 0x41 : 0x42).signed(type === 'i32' ? Number(value) | 0 : BigInt.asIntN(64, BigInt(value)));
    return;
  }
  const bytes = new Uint8Array(type === 'f32' ? 4 : 8);
  const view = new DataView(bytes.buffer);
  if (type === 'f32') view.setFloat32(0, value, true);
  else view.setFloat64(0, value, true);
  writer.byte(type === 'f32' ? 0x43 : 0x44).bytes(bytes);
}

function local(writer, index, from, to) {
  writer.byte(0x20).unsigned(index);
  if (from === to) return;
  if (from === 'f32' && to === 'f64') writer.byte(0xbb);
  else if (from === 'i32' && to === 'i64') writer.byte(0xad);
  else if (from === 'i64' && to === 'i32') writer.byte(0xa7);
  else throw new Error(`Unsupported Wasm operand promotion ${from} to ${to}`);
}

function instructionBody(instruction, imports) {
  const writer = new WasmBinary();
  const operands = instruction.kind === 'binary' || instruction.kind === 'unary' ? instruction.inputs : [];
  writer.unsigned(operands.length);
  for (const type of operands) writer.unsigned(1).byte(valueTypes[type]);
  const call = name => writer.byte(0x10).unsigned(imports.get(name));
  if (instruction.kind === 'host') {
    constant(writer, 'i32', instruction.pc);
    call(wasmHostImport(instruction.name));
  } else if (instruction.kind === 'constant') {
    constant(writer, instruction.type, instruction.value);
    call(`push_${instruction.type}`);
  } else {
    for (let index = operands.length - 1; index >= 0; index--) {
      call(`pop_${operands[index]}`);
      writer.byte(0x21).unsigned(index);
    }
    emitArithmetic(writer, instruction);
    call(`push_${instruction.type}`);
  }
  return writer.byte(0x0b);
}

function emitArithmetic(writer, instruction) {
  const {name, type, inputs, kind} = instruction;
  if (kind === 'binary') {
    local(writer, 0, inputs[0], type);
    local(writer, 1, inputs[1], type);
    const opcode = operations[type][name];
    if (opcode === undefined) throw new Error(`Unsupported native Wasm operation ${type}.${name}`);
    writer.byte(opcode);
    return;
  }
  if (type === 'f32' || type === 'f64') {
    local(writer, 0, type, type);
    writer.byte(type === 'f32' ? 0x8c : 0x9a);
    return;
  }
  if (name === 'neg') constant(writer, type, 0);
  local(writer, 0, type, type);
  if (name === 'not') constant(writer, type, -1);
  writer.byte(operations[type][name === 'neg' ? 'sub' : 'xor']);
}

/** Encode a module with one typed native entry per CIL safepoint; no JS source generation. */
export function encodeWasmIR(ir) {
  if (ir.version !== 1 || !ir.instructions.length || ir.instructions.length > 65536) {
    throw new RangeError('Unsupported or oversized Wasm IR');
  }
  const signatures = [...wasmImportSignatures, {parameters: [], results: []}];
  const types = new WasmBinary().unsigned(signatures.length);
  for (const signature of signatures) {
    types.byte(0x60).unsigned(signature.parameters.length);
    for (const type of signature.parameters) types.byte(valueTypes[type]);
    types.unsigned(signature.results.length);
    for (const type of signature.results) types.byte(valueTypes[type]);
  }
  const imports = new WasmBinary().unsigned(wasmImportSignatures.length);
  const importIndices = new Map();
  wasmImportSignatures.forEach((signature, index) => {
    imports.text('runtime').text(signature.name).byte(0).unsigned(index);
    importIndices.set(signature.name, index);
  });
  const functions = new WasmBinary().unsigned(ir.instructions.length);
  const exports = new WasmBinary().unsigned(ir.instructions.length);
  const code = new WasmBinary().unsigned(ir.instructions.length);
  for (const instruction of ir.instructions) {
    functions.unsigned(wasmImportSignatures.length);
    exports.text(`p${instruction.pc}`).byte(0).unsigned(wasmImportSignatures.length + instruction.pc);
    const body = instructionBody(instruction, importIndices);
    code.unsigned(body.data.length).bytes(body.data);
  }
  return new WasmBinary().bytes([0, 97, 115, 109, 1, 0, 0, 0])
    .section(1, types).section(2, imports).section(3, functions).section(7, exports).section(10, code).finish();
}
