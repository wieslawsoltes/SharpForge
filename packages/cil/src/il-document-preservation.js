import { equalBytes } from './binary.js';

const handlerFields = Object.freeze(['flags', 'start', 'end', 'target', 'handlerEnd', 'catchType']);

/** Compare every body fact represented by the document; physical header/EH encodings are retained when equal. */
export function sameILBody(compiled, original) {
  if (compiled.maxStack !== original.maxStack || compiled.localSignature !== original.localSignature ||
      compiled.initLocals !== original.initLocals || !equalBytes(compiled.code, original.code) ||
      compiled.handlers.length !== original.handlers.length) return false;
  return compiled.handlers.every((handler, index) =>
    handlerFields.every(field => handler[field] === original.handlers[index][field]));
}

/** NaN text has no payload syntax: retain bytes only at the original instruction's label and exact opcode. */
export function originalNaNInstructions(original) {
  const result = new Map();
  for (const instruction of original?.instructions ?? []) {
    if ((instruction.operandKind !== 'f32' && instruction.operandKind !== 'f64') || !Number.isNaN(instruction.operand)) continue;
    const end = instruction.offset + instruction.size;
    const width = instruction.operandKind === 'f32' ? 4 : 8;
    result.set(instruction.label, {
      name: instruction.name,
      operandBytes: original.body.code.subarray(end - width, end),
    });
  }
  return result;
}
