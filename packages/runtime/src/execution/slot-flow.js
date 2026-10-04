import {CilOpcodes} from '@sharpforge/cil';
import {Op} from '@sharpforge/bytecode';

const sourceTerminals = new Set([Op.RET, Op.THROW, Op.RETHROW, Op.ENDFINALLY]);
const sourceBranches = new Set([Op.JUMP, Op.JTRUE, Op.JFALSE]);
// A new source opcode must declare its slot/control-flow effects before pruning can use it.
const sourceKnown = new Set(['SEQ', 'CONST', 'LDLOC', 'STLOC', 'LDSTATIC', 'STSTATIC', 'LDFLD', 'STFLD',
  'DUP', 'POP', 'BINARY', 'UNARY', 'JUMP', 'JFALSE', 'JTRUE', 'CALL', 'BUILTIN', 'RET', 'NEWOBJ', 'NEWARR',
  'LDELEM', 'STELEM', 'LENGTH', 'THROW', 'RETHROW', 'CONVERT', 'NOP', 'ENDFINALLY', 'DELEGATE', 'ENUM'].map(name => Op[name]));
const row = () => ({next: [], use: -1, define: -1, address: -1});

function cilSlots(instruction, result, argumentCount, slotCount) {
  const match = /^(ld|st)(arg|loc)(a)?(?:\.s|\.(\d+))?$/.exec(instruction.name);
  if (!match) return true;
  const slot = match[4] === undefined ? instruction.operand : Number(match[4]);
  const argument = match[2] === 'arg';
  const limit = argument ? argumentCount : slotCount - argumentCount;
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= limit) return false;
  const position = slot + (argument ? 0 : argumentCount);
  if (match[1] === 'st') result.define = position;
  else result.use = position;
  if (match[3]) result.address = position;
  return true;
}

function cilFlow(method, slots, argumentCount, maximumEdges) {
  const instructions = method.instructions;
  if (instructions.some(instruction => !instruction || !Number.isSafeInteger(instruction.offset) || instruction.offset < 0)) return null;
  const offsets = new Map(instructions.map((instruction, index) => [instruction.offset, index]));
  if (offsets.size !== instructions.length) return null;
  const rows = [], implicitArguments = new Set();
  let edges = 0;
  for (let index = 0; index < instructions.length; index++) {
    const instruction = instructions[index];
    if (!Object.hasOwn(CilOpcodes, instruction.name)) return null;
    const opcode = CilOpcodes[instruction.name], current = row();
    if (!cilSlots(instruction, current, argumentCount, slots)) return null;
    if (opcode.operand === 'switch') {
      if (!Array.isArray(instruction.operand) || instruction.operand.length > maximumEdges - edges) return null;
      for (const target of instruction.operand) current.next.push(offsets.get(target));
    } else if (opcode.operand === 'br8' || opcode.operand === 'br32') current.next.push(offsets.get(instruction.operand));
    if (instruction.name === 'jmp' || instruction.name === 'arglist') {
      // These operations expose incoming arguments without explicit ldarg instructions.
      for (let position = 0; position < argumentCount; position++) implicitArguments.add(position);
    }
    if (instruction.name !== 'jmp' && !['Return', 'Throw', 'Branch'].includes(opcode.flowControl) && index + 1 < instructions.length) {
      current.next.push(index + 1);
    }
    if (current.next.some(target => target === undefined)) return null;
    edges += current.next.length;
    if (edges > maximumEdges) return null;
    rows.push(current);
  }
  return {rows, slots, argumentCount, implicitArguments};
}

function sourceFlow(method, slots, maximumEdges) {
  const rows = [], count = method.code.length / 3;
  let edges = 0;
  for (let index = 0; index < count; index++) {
    const opcode = method.code[index * 3], operand = method.code[index * 3 + 1], current = row();
    if (!sourceKnown.has(opcode)) return null;
    if (opcode === Op.LDLOC || opcode === Op.STLOC) {
      if (operand < 0 || operand >= slots) return null;
      if (opcode === Op.LDLOC) current.use = operand;
      else current.define = operand;
    }
    if (sourceBranches.has(opcode)) current.next.push(operand);
    if (!sourceTerminals.has(opcode) && opcode !== Op.JUMP && index + 1 < count) current.next.push(index + 1);
    if (current.next.some(target => target < 0 || target >= count)) return null;
    edges += current.next.length;
    if (edges > maximumEdges) return null;
    rows.push(current);
  }
  return {rows, slots, argumentCount: 0, implicitArguments: new Set()};
}

/** Describe only local/argument reads, overwrites and address escapes on bounded normal CFGs. */
export function slotFlow(method, limits) {
  if (!method || !Array.isArray(method.locals) || method.signature &&
      (!Array.isArray(method.signature.parameters) || typeof method.signature.isStatic !== 'boolean')) return null;
  const cil = !!method.signature;
  if (cil ? !Array.isArray(method.instructions) : !(method.code instanceof Int32Array)) return null;
  const count = cil ? method.instructions?.length : method.code?.length / 3;
  const arguments_ = cil ? method.signature.parameters.length + Number(!method.signature.isStatic) : 0;
  const slots = arguments_ + method.locals.length;
  if (!Number.isSafeInteger(count) || count < 1 || count > limits.instructions || slots < 1 ||
      slots > limits.slots || count * Math.ceil(slots / 32) > limits.words || method.handlers?.length) return null;
  return cil ? cilFlow(method, slots, arguments_, limits.edges) : sourceFlow(method, slots, limits.edges);
}
