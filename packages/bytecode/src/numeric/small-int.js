import {numericFault} from './checked.js';

const aliases = Object.freeze({
  'System.SByte': 'sbyte', 'System.Byte': 'byte', 'System.Int16': 'short',
  'System.UInt16': 'ushort', 'System.Char': 'char', 'System.Boolean': 'bool'
});
const layouts = Object.freeze({
  sbyte: Object.freeze({bits: 8, unsigned: false}),
  byte: Object.freeze({bits: 8, unsigned: true}),
  short: Object.freeze({bits: 16, unsigned: false}),
  ushort: Object.freeze({bits: 16, unsigned: true}),
  char: Object.freeze({bits: 16, unsigned: true}),
  bool: Object.freeze({bits: 8, unsigned: true})
});
const suffixes = Object.freeze({i1: 'sbyte', u1: 'byte', i2: 'short', u2: 'ushort'});

/** CLI small storage truncates first, then sign/zero extends to the i4 stack. */
export function smallInteger(value, type, context) {
  const name = Object.hasOwn(aliases, type) ? aliases[type] : type;
  const layout = Object.hasOwn(layouts, name) ? layouts[name] : null;
  if (!layout) numericFault(context, 'InvalidProgramException', 'Small integer storage type required');
  if (typeof value !== 'bigint' && !Number.isInteger(value)) {
    numericFault(context, 'InvalidProgramException', 'Small integer storage requires an integer');
  }
  const narrow = layout.unsigned ? BigInt.asUintN : BigInt.asIntN;
  return Number(narrow(layout.bits, BigInt(value)));
}

/** The indirect load suffix supplies signedness independently of the destination type. */
export function smallIntegerIndirect(value, suffix, context) {
  return smallInteger(value, Object.hasOwn(suffixes, suffix) ? suffixes[suffix] : null, context);
}
