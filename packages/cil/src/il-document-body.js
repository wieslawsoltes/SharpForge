import { CilOpcodes, CilWriter, decodeInstructions } from './opcodes.js';
import { Writer, CilError } from './binary.js';
import { ilLabel } from './inspector.js';
import { originalNaNInstructions } from './il-document-preservation.js';

const operandSizes = Object.freeze({ u8: 1, i8: 1, br8: 1, u16: 2, i32: 4, token: 4, br32: 4, f32: 4, f64: 8, i64: 8 });

export function parseILInteger(source, min, max) {
  const value = Number(source);
  if (!Number.isInteger(value) || value < min || value > max) throw new CilError(`Invalid integer operand '${source}'`);
  return value;
}

function instructionLabels(method) {
  const labels = new Map();
  let offset = 0;
  for (const instruction of method.instructions) {
    if (labels.has(instruction.label)) throw new CilError(`Duplicate label ${instruction.label}`);
    if (!Object.hasOwn(CilOpcodes, instruction.name)) throw new CilError(`Unknown opcode ${instruction.name}`);
    labels.set(instruction.label, offset);
    const opcode = CilOpcodes[instruction.name];
    instruction.offset = offset;
    let size = opcode.value > 255 ? 2 : 1;
    if (opcode.operand === 'switch') {
      if (!/^\(.*\)$/.test(instruction.operand)) throw new CilError('Invalid switch targets');
      instruction.targets = instruction.operand.slice(1, -1).split(',').map(value => value.trim()).filter(Boolean);
      size += 4 + instruction.targets.length * 4;
    } else size += operandSizes[opcode.operand] ?? 0;
    instruction.size = size;
    offset += size;
    if (offset > 16 * 1024 * 1024) throw new CilError('Method size budget exceeded');
  }
  // The implicit end label is legal for exception-range ends, never branch targets.
  const endLabel = method.endLabel ?? ilLabel(method.originalSize);
  if (!labels.has(endLabel)) labels.set(endLabel, offset);
  return (label, allowEnd = false) => {
    if (!labels.has(label)) throw new CilError(`Unknown IL label '${label}'`);
    const target = labels.get(label);
    if (!allowEnd && target === offset) throw new CilError('Branch cannot target end of method');
    return target;
  };
}

function readOperand(instruction, target, options) {
  const { relaxBranches, userStrings } = options;
  const kind = CilOpcodes[instruction.name].operand;
  if (!kind) {
    if (instruction.operand) throw new CilError(`${instruction.name} has no operand`);
    return undefined;
  }
  if (kind.startsWith('br')) {
    const delta = target(instruction.operand) - instruction.offset - instruction.size;
    if (relaxBranches) return instruction.operand;
    if (kind === 'br8' && (delta < -128 || delta > 127)) throw new CilError('Short branch out of range; use the long opcode');
    return delta;
  }
  if (kind === 'switch') {
    return instruction.targets.map(label => {
      const delta = target(label) - instruction.offset - instruction.size;
      return relaxBranches ? label : delta;
    });
  }
  if (kind === 'i64') {
    let value;
    try { value = BigInt(instruction.operand); } catch { throw new CilError('Invalid Int64 literal'); }
    if (value < -(1n << 63n) || value >= (1n << 63n)) throw new CilError('Int64 literal out of range');
    return value;
  }
  if (kind === 'f32' || kind === 'f64') {
    const value = Number(instruction.operand);
    if (!instruction.operand || Number.isNaN(value) && instruction.operand !== 'NaN') throw new CilError('Invalid floating literal');
    return value;
  }
  if (instruction.name === 'ldstr' && instruction.operand.startsWith('"')) return userStrings.literalToken(instruction.operand);
  return parseILInteger(instruction.operand, kind === 'i8' ? -128 : kind === 'i32' ? -2147483648 : 0,
    kind === 'u8' ? 255 : kind === 'i8' ? 127 : kind === 'u16' ? 65535 : kind === 'i32' ? 2147483647 : 4294967295);
}

function encodeBody(method, code, handlers) {
  const body = new Writer().u16(0x3003 | (method.initLocals ? 0x10 : 0) | (handlers.length ? 8 : 0))
    .u16(method.maxStack).u32(code.length).u32(method.localSignature).bytes(code);
  if (handlers.length) {
    body.pad();
    const size = 4 + handlers.length * 24;
    body.u8(0x41).u8(size).u8(size >>> 8).u8(size >>> 16);
    for (const handler of handlers) {
      if (handler.start >= handler.end || handler.target >= handler.handlerEnd) throw new CilError('Invalid exception range');
      body.u32(handler.flags).u32(handler.start).u32(handler.end - handler.start)
        .u32(handler.target).u32(handler.handlerEnd - handler.target).u32(handler.catchType);
    }
  }
  return body.finish();
}

/** Compile visible IL body text; optional layout maps this body's existing EH labels explicitly. */
export function compileILBody(method, options = {}) {
  return compileILBodyDetails(method, options).bytes;
}

/** Internal compile result exposes exact body facts so the image writer can prove a no-change rewrite. */
export function compileILBodyDetails(method, options = {}) {
  const { relaxBranches = false } = options;
  const target = instructionLabels(method), writer = new CilWriter();
  const originalNaNs = originalNaNInstructions(options.original);
  for (const instruction of method.instructions) {
    if (relaxBranches) writer.mark(instruction.label);
    const operand = readOperand(instruction, target, options);
    const original = originalNaNs.get(instruction.label);
    writer.op(instruction.name, operand);
    if (Number.isNaN(operand) && original?.name === instruction.name) {
      writer.buffer.set(original.operandBytes, writer.length - original.operandBytes.length);
    }
  }
  const layout = relaxBranches ? writer.finishWithLayout() : { code: writer.finish(), offsetMap: null };
  decodeInstructions(layout.code);
  const relocatedTarget = (label, allowEnd = false) => {
    const offset = target(label, allowEnd);
    return layout.offsetMap ? layout.offsetMap.get(offset) : offset;
  };
  const handlers = method.handlers.map(handler => ({ ...handler,
    start: relocatedTarget(handler.start), end: relocatedTarget(handler.end, true),
    target: relocatedTarget(handler.target), handlerEnd: relocatedTarget(handler.handlerEnd, true),
    catchType: handler.flags === 1 ? relocatedTarget(handler.catchType) : parseILInteger(handler.catchType, 0, 0xffffffff),
  }));
  return {
    bytes: encodeBody(method, layout.code, handlers),
    code: layout.code,
    handlers,
    maxStack: method.maxStack,
    localSignature: method.localSignature,
    initLocals: method.initLocals,
  };
}
