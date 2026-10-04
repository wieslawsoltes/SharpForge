import { Reader, CilError } from '../binary.js';
import { CilOpcodes } from './catalog.js';

const byValue = new Map(Object.values(CilOpcodes).map(opcode => [opcode.value, opcode]));

/** Internal byte decoder; layout supplies its own target resolution before boundary validation. */
export function decodeInstructionBytes(bytes, maxInstructions = 1_000_000, maxSwitchTargets = Infinity) {
  const reader = new Reader(bytes), result = [];
  let switchTargets = 0;
  while (reader.position < reader.end) {
    if (result.length >= maxInstructions) throw new CilError('IL instruction limit exceeded');
    const offset = reader.position;
    let value = reader.u8();
    if (value === 0xfe) value = 0xfe00 | reader.u8();
    const opcode = byValue.get(value);
    if (!opcode) throw new CilError(`Unsupported CIL opcode 0x${value.toString(16)}`, offset);
    let operand;
    switch (opcode.operand) {
      case 'u8': operand = reader.u8(); break;
      case 'i8': operand = (reader.u8() << 24) >> 24; break;
      case 'u16': operand = reader.u16(); break;
      case 'i32': operand = reader.i32(); break;
      case 'f32': operand = reader.f32(); break;
      case 'f64': operand = reader.f64(); break;
      case 'i64': operand = reader.i64(); break;
      case 'switch': {
        const count = reader.u32();
        switchTargets += count;
        if (count > 1_000_000 || count > (reader.end - reader.position) / 4 || switchTargets > maxSwitchTargets) {
          throw new CilError('Invalid switch table', offset);
        }
        const end = reader.position + count * 4;
        operand = Array.from({ length: count }, () => reader.i32() + end);
        break;
      }
      case 'token': operand = reader.u32(); break;
      case 'br32': operand = reader.i32() + reader.position; break;
      case 'br8': operand = ((reader.u8() << 24) >> 24) + reader.position; break;
    }
    result.push({ offset, size: reader.position - offset, name: opcode.name, operand, operandKind: opcode.operand });
  }
  return result;
}

export function decodeInstructions(bytes, { maxInstructions = 1_000_000 } = {}) {
  const result = decodeInstructionBytes(bytes, maxInstructions);
  const starts = new Set(result.map(instruction => instruction.offset));
  for (const instruction of result) {
    const targets = instruction.operandKind === 'switch' ? instruction.operand
      : instruction.operandKind.startsWith('br') ? [instruction.operand] : [];
    for (const target of targets) {
      if (!starts.has(target)) throw new CilError('Branch target is not an instruction boundary', instruction.offset);
    }
  }
  return result;
}
