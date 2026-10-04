/** Stable source instruction and numeric mode identifiers. Existing wire IDs never change. */
export const FORMAT_VERSION = 2;
export const EnumConvertBase = 65536;
const opcodeNames = [
  'SEQ', 'CONST', 'LDLOC', 'STLOC', 'LDSTATIC', 'STSTATIC', 'LDFLD', 'STFLD', 'DUP', 'POP',
  'BINARY', 'UNARY', 'JUMP', 'JFALSE', 'JTRUE', 'CALL', 'BUILTIN', 'RET', 'NEWOBJ', 'NEWARR',
  'LDELEM', 'STELEM', 'LENGTH', 'THROW', 'RETHROW', 'CONVERT', 'NOP', 'ENDFINALLY', 'DELEGATE', 'ENUM',
  'EXTCALL', 'EXTNEWOBJ', 'EXTLDFLD', 'EXTSTFLD', 'EXTLDSTATIC', 'EXTSTSTATIC'
];
export const Op = Object.freeze(Object.fromEntries(opcodeNames.map((name, index) => [name, index])));
export const OpName = Object.freeze(Object.keys(Op));
const binaryNames = ['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&', '|', '^', '<<', '>>', '>>>'];
export const Binary = Object.freeze(Object.fromEntries(binaryNames.map((name, index) => [name, index])));
export const BinaryName = Object.freeze(Object.keys(Binary));
export const Unary = Object.freeze({'-': 0, '+': 1, '!': 2, '~': 3});
export const UnaryName = Object.freeze(Object.keys(Unary));
