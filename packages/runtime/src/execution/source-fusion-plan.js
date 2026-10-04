import {Op, Binary} from '@sharpforge/bytecode';
import {executeLocalBinary, executeCompareBranch} from './source-fusion-handlers.js';

const comparisons = new Set([Binary['=='], Binary['!='], Binary['<'], Binary['<='], Binary['>'], Binary['>=']]);

function targets(code, count) {
  const entries = new Uint8Array(count);
  for (let index = 0; index < count; index++) {
    const opcode = code[index * 3];
    if (opcode === Op.JUMP || opcode === Op.JFALSE || opcode === Op.JTRUE) entries[code[index * 3 + 1]] = 1;
  }
  return entries;
}

function straight(entries, start, length) {
  if (start + length > entries.length) return false;
  for (let offset = 1; offset < length; offset++) if (entries[start + offset]) return false;
  return true;
}

function tail(code, start, prefix, entries, operator) {
  const opcode = code[(start + prefix) * 3];
  const supported = opcode === Op.STLOC || comparisons.has(operator) && (opcode === Op.JFALSE || opcode === Op.JTRUE);
  if (!supported || !straight(entries, start, prefix + 1)) return {tail: 0, target: 0, discard: false, length: prefix};
  const discard = opcode === Op.STLOC && code[(start + prefix + 1) * 3] === Op.POP && straight(entries, start, prefix + 2);
  return {tail: opcode, target: code[(start + prefix) * 3 + 1], discard, length: prefix + 1 + Number(discard)};
}

function localGroup(code, start, entries) {
  if (code[start * 3] !== Op.LDLOC || !straight(entries, start, 3)) return null;
  const right = code[(start + 1) * 3], binary = (start + 2) * 3;
  if ((right !== Op.LDLOC && right !== Op.CONST) || code[binary] !== Op.BINARY || code[binary + 2] === 2) return null;
  const operator = code[binary + 1];
  return Object.freeze({
    execute: executeLocalBinary, left: code[start * 3 + 1], right: code[(start + 1) * 3 + 1],
    constant: right === Op.CONST, operator, mode: code[binary + 2], ...tail(code, start, 3, entries, operator)
  });
}

function compareGroup(code, start, entries) {
  const operator = code[start * 3 + 1], mode = code[start * 3 + 2];
  if (code[start * 3] !== Op.BINARY || !comparisons.has(operator) || mode === 2) return null;
  const ending = tail(code, start, 1, entries, operator);
  if (ending.tail !== Op.JFALSE && ending.tail !== Op.JTRUE) return null;
  return Object.freeze({execute: executeCompareBranch, left: 0, right: 0, constant: false, operator, mode, ...ending});
}

/** Linear cold preparation; plans retain no frames, values, mutable execution state or generated code. */
export function buildSourceFusionPlan(method, statistics) {
  const started = performance.now(), code = method.code, count = code.length / 3;
  const groups = Array(count).fill(null), entries = targets(code, count);
  let groupCount = 0, fusedInstructions = 0;
  if (!method.handlers.length) {
    for (let index = 0; index < count; index++) {
      const group = localGroup(code, index, entries) ?? compareGroup(code, index, entries);
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
