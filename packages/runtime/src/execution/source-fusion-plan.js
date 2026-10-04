import {Op} from '@sharpforge/bytecode';
import {executeSourceBlock} from './source-fusion-handlers.js';
import {prepareSourceCall} from './source-prepared-calls.js';
import {prepareSourceInteger} from './source-fusion-numerics.js';

const terminal = new Set([Op.JUMP, Op.JFALSE, Op.JTRUE, Op.CALL, Op.RET]);
const supported = new Set([
  Op.SEQ, Op.NOP, Op.CONST, Op.LDLOC, Op.STLOC, Op.DUP, Op.POP, Op.BINARY, Op.UNARY, Op.CONVERT, ...terminal
]);
const maximumBlockLength = 32;

function targets(code, count) {
  const entries = new Uint8Array(count);
  for (let index = 0; index < count; index++) {
    const opcode = code[index * 3];
    if (opcode === Op.JUMP || opcode === Op.JFALSE || opcode === Op.JTRUE) entries[code[index * 3 + 1]] = 1;
  }
  return entries;
}

function block(code, start, entries, image) {
  const instructions = [];
  for (let index = start; index < entries.length && index < start + maximumBlockLength; index++) {
    if (index !== start && entries[index]) break;
    const base = index * 3, opcode = code[base], first = code[base + 1], second = code[base + 2];
    if (!supported.has(opcode)) break;
    // Concatenation allocates guest strings. Its allocation boundary stays in ordinary dispatch.
    if (opcode === Op.BINARY && second === 2) break;
    instructions.push(Object.freeze({opcode, first, second,
      integer: opcode === Op.BINARY ? prepareSourceInteger(first, second) : null,
      call: opcode === Op.CALL ? prepareSourceCall(image, first, second) : null}));
    if (terminal.has(opcode)) break;
  }
  if (instructions.length < 2) return null;
  const lastOpcode = instructions[instructions.length - 1].opcode;
  return Object.freeze({execute: executeSourceBlock, length: instructions.length,
    retirementBoundary: lastOpcode === Op.CALL || lastOpcode === Op.RET, instructions: Object.freeze(instructions)});
}

/** Linear cold preparation: bounded blocks end at control transfer and retain no guest values or frames. */
export function buildSourceFusionPlan(method, statistics, image) {
  const started = performance.now(), code = method.code, count = code.length / 3;
  const groups = Array(count).fill(null), entries = targets(code, count);
  let groupCount = 0, fusedInstructions = 0;
  if (!method.handlers.length) {
    for (let index = 0; index < count; index++) {
      const group = block(code, index, entries, image);
      if (!group) continue;
      groups[index] = group;
      groupCount++;
      fusedInstructions += group.length;
      index += group.length - 1;
    }
  }
  statistics.sourcePlans++;
  statistics.sourcePlanMilliseconds += performance.now() - started;
  return Object.freeze({groups: Object.freeze(groups), groupCount, fusedInstructions});
}
