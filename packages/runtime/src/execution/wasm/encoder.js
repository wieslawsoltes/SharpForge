import {WasmBinary} from './binary.js';
import {wasmValueTypes, wasmOperations, wasmImportSignatures, wasmHostImport, requiresHostArithmetic} from './encoding-profile.js';
import {validateWasmIR, wasmEncodingLimits} from './validate-ir.js';

function constant(writer, type, value) {
  if (type === 'i32' || type === 'i64') {
    writer.byte(type === 'i32' ? 0x41 : 0x42).signed(value);
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
  else throw new TypeError(`Unsupported Wasm operand promotion ${from} to ${to}`);
}

function arithmetic(writer, instruction) {
  const {name, type, inputs, kind} = instruction;
  if (kind === 'binary') {
    local(writer, 0, inputs[0], type);
    local(writer, 1, inputs[1], type);
    writer.byte(wasmOperations[type][name]);
  } else if (type === 'f32' || type === 'f64') {
    local(writer, 0, type, type);
    writer.byte(type === 'f32' ? 0x8c : 0x9a);
  } else {
    if (name === 'neg') constant(writer, type, 0);
    local(writer, 0, type, type);
    if (name === 'not') constant(writer, type, -1);
    writer.byte(wasmOperations[type][name === 'neg' ? 'sub' : 'xor']);
  }
}

function instructionBody(instruction, imports, byteLimit) {
  const writer = new WasmBinary(byteLimit);
  const host = instruction.kind === 'host' || requiresHostArithmetic(instruction);
  const operands = !host && instruction.requiresOperandGuards ? instruction.inputs : [];
  writer.unsigned(operands.length);
  for (const type of operands) writer.unsigned(1).byte(wasmValueTypes[type]);
  const call = name => writer.byte(0x10).unsigned(imports.get(name));
  if (host) {
    constant(writer, 'i32', instruction.pc);
    call(wasmHostImport(instruction.name));
  } else if (instruction.kind === 'constant') {
    constant(writer, instruction.type, instruction.value);
    call(`push_${instruction.type}`);
  } else {
    // A false guard branches directly to the host before any operand is popped.
    constant(writer, 'i32', instruction.pc);
    call('guard');
    writer.byte(0x04).byte(0x40);
    for (let index = operands.length - 1; index >= 0; index--) {
      call(`pop_${operands[index]}`);
      writer.byte(0x21).unsigned(index);
    }
    arithmetic(writer, instruction);
    call(`push_${instruction.type}`);
    writer.byte(0x05);
    constant(writer, 'i32', instruction.pc);
    call('host');
    writer.byte(0x0b);
  }
  return writer.byte(0x0b);
}

/** Encode immutable typed IR into owned bytes, with bounded output and guarded runtime imports. */
export function encodeWasmIR(ir, options = {}) {
  const limits = wasmEncodingLimits(options);
  validateWasmIR(ir, limits);
  const signatures = [...wasmImportSignatures, {parameters: [], results: []}];
  const types = new WasmBinary(limits.bytes).unsigned(signatures.length);
  for (const signature of signatures) {
    types.byte(0x60).unsigned(signature.parameters.length);
    for (const type of signature.parameters) types.byte(wasmValueTypes[type]);
    types.unsigned(signature.results.length);
    for (const type of signature.results) types.byte(wasmValueTypes[type]);
  }
  const imports = new WasmBinary(limits.bytes).unsigned(wasmImportSignatures.length);
  const importIndices = new Map();
  wasmImportSignatures.forEach((signature, index) => {
    imports.text('runtime').text(signature.name).byte(0).unsigned(index);
    importIndices.set(signature.name, index);
  });
  const functions = new WasmBinary(limits.bytes).unsigned(ir.instructions.length);
  const exports = new WasmBinary(limits.bytes).unsigned(ir.instructions.length);
  const code = new WasmBinary(limits.bytes).unsigned(ir.instructions.length);
  for (const instruction of ir.instructions) {
    functions.unsigned(wasmImportSignatures.length);
    exports.text(`p${instruction.pc}`).byte(0).unsigned(wasmImportSignatures.length + instruction.pc);
    const body = instructionBody(instruction, importIndices, limits.bytes);
    code.unsigned(body.data.length).bytes(body.data);
  }
  return new WasmBinary(limits.bytes).bytes([0, 97, 115, 109, 1, 0, 0, 0])
    .section(1, types).section(2, imports).section(3, functions).section(7, exports).section(10, code).finish();
}
