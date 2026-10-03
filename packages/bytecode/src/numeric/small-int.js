import {numericTypeName} from './numeric-types.js';
import {numericFault} from './checked.js';

const layouts = Object.freeze({
  sbyte: Object.freeze({bits: 8, unsigned: false}),
  byte: Object.freeze({bits: 8, unsigned: true}),
  short: Object.freeze({bits: 16, unsigned: false}),
  ushort: Object.freeze({bits: 16, unsigned: true}),
  char: Object.freeze({bits: 16, unsigned: true}),
  bool: Object.freeze({bits: 8, unsigned: true}),
});

/** CLI small storage truncates first, then sign/zero extends to the i4 stack. */
export function smallInteger(value, type, context) {
  const layout = layouts[numericTypeName(type)];
  if (!layout) numericFault(context, 'InvalidProgramException', 'Small integer storage type required');
  if (typeof value !== 'bigint' && !Number.isInteger(value)) {
    numericFault(context, 'InvalidProgramException', 'Small integer storage requires an integer');
  }
  const narrow = layout.unsigned ? BigInt.asUintN : BigInt.asIntN;
  return Number(narrow(layout.bits, BigInt(value)));
}

/** Decode the load/store opcode suffix without changing its signed load meaning. */
export function smallIntegerIndirect(value, suffix, context) {
  const type = {i1: 'sbyte', u1: 'byte', i2: 'short', u2: 'ushort'}[suffix];
  return smallInteger(value, type, context);
}
