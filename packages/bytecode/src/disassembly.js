import {Op, OpName} from './opcodes.js';

/** Decode all methods, or one method ID, without changing the image or its source points. */
export function disassemble(image, methodId) {
  const methods = methodId === undefined ? image.methods : [image.methods[methodId]];
  return methods.map(method => ({
    name: method.qualifiedName,
    id: method.id,
    instructions: Array.from({length: method.code.length / 3}, (_, offset) => ({
      offset,
      op: OpName[method.code[offset * 3]],
      a: method.code[offset * 3 + 1],
      b: method.code[offset * 3 + 2],
      point: method.code[offset * 3] === Op.SEQ ? image.sequencePoints[method.code[offset * 3 + 1]] : null,
    })),
  }));
}
