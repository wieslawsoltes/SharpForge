import {Op} from '@sharpforge/bytecode';

const cilTerminals = new Set(['ret', 'throw', 'rethrow', 'endfinally', 'endfilter', 'jmp']);
const sourceTerminals = new Set([Op.RET, Op.THROW, Op.RETHROW, Op.ENDFINALLY, Op.ENDFILTER]);
const maximumWords = 4 * 1024 * 1024;

function cilFlow(method) {
  const instructions = method.instructions;
  const offsets = new Map(instructions.map((instruction, index) => [instruction.offset, index]));
  const argumentCount = method.signature.parameters.length + Number(!method.signature.isStatic);
  const slots = argumentCount + method.locals.length;
  const rows = instructions.map((instruction, index) => {
    const name = instruction.name, next = [], use = [], define = [], address = [];
    const slot = instruction.operand ?? Number(name.split('.').at(-1));
    if (/^(ld|st)(arg|loc)/.test(name)) {
      const position = slot + (name.includes('loc') ? argumentCount : 0);
      if (name.startsWith('st')) define.push(position);
      else use.push(position);
      if (/^ld(arg|loc)a/.test(name)) address.push(position);
    }
    if (name === 'switch') for (const target of instruction.operand) next.push(offsets.get(target));
    else if (instruction.operandKind.startsWith('br')) next.push(offsets.get(instruction.operand));
    if (!cilTerminals.has(name) && !/^(br|leave)(\.s)?$/.test(name) && index + 1 < instructions.length) next.push(index + 1);
    return {next, use, define, address};
  });
  return {rows, slots, argumentCount};
}

function sourceFlow(method) {
  const rows = [], count = method.code.length / 3;
  for (let index = 0; index < count; index++) {
    const opcode = method.code[index * 3], operand = method.code[index * 3 + 1], second = method.code[index * 3 + 2];
    const next = [], use = [], define = [], address = [];
    if (opcode === Op.LDLOC) use.push(operand);
    if (opcode === Op.STLOC) define.push(operand);
    if (opcode === Op.ADDRESS && ((operand & 3) === 0 || operand & 8)) {
      use.push(second);
      address.push(second);
    }
    if ([Op.JUMP, Op.JTRUE, Op.JFALSE].includes(opcode)) next.push(operand);
    if (!sourceTerminals.has(opcode) && opcode !== Op.JUMP && index + 1 < count) next.push(index + 1);
    rows.push({next, use, define, address});
  }
  return {rows, slots: method.locals.length, argumentCount: 0};
}

/** Backward may-liveness. Address-taken and exceptional slots remain conservative roots. */
export function slotLiveness(method) {
  const flow = method.signature ? cilFlow(method) : sourceFlow(method);
  const {rows, slots, argumentCount} = flow, words = Math.ceil(slots / 32);
  // EH state machines can enter filters while younger frames remain live. Until a
  // verifier supplies exceptional liveness, preserving these slots is mandatory.
  if (method.handlers?.length || rows.length * words > maximumWords) return {argumentCount, live: null, words, slots};
  const live = new Uint32Array(rows.length * words), pinned = new Uint32Array(words);
  const predecessors = rows.map(() => []);
  for (let index = 0; index < rows.length; index++) {
    for (const next of rows[index].next) if (next !== undefined) predecessors[next].push(index);
    for (const slot of rows[index].address) pinned[slot >>> 5] |= 1 << (slot & 31);
  }
  const work = rows.map((_, index) => index), queued = new Uint8Array(rows.length).fill(1), output = new Uint32Array(words);
  while (work.length) {
    const index = work.pop(), row = rows[index], start = index * words;
    queued[index] = 0;
    output.fill(0);
    for (const next of row.next) {
      if (next === undefined) continue;
      for (let word = 0; word < words; word++) output[word] |= live[next * words + word];
    }
    for (const slot of row.define) output[slot >>> 5] &= ~(1 << (slot & 31));
    for (const slot of row.use) output[slot >>> 5] |= 1 << (slot & 31);
    let changed = false;
    for (let word = 0; word < words; word++) {
      const value = (output[word] | pinned[word]) >>> 0;
      if (live[start + word] !== value) { live[start + word] = value; changed = true; }
    }
    if (changed) for (const previous of predecessors[index]) {
      if (!queued[previous]) { queued[previous] = 1; work.push(previous); }
    }
  }
  return {argumentCount, live, words, slots};
}

export function liveSlot(plan, pc, index) {
  if (!plan.live || index >= plan.slots || pc < 0 || pc * plan.words >= plan.live.length) return true;
  return !!(plan.live[pc * plan.words + (index >>> 5)] & (1 << (index & 31)));
}
