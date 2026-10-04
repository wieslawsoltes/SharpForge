/** Versioned, structured-cloneable stack bytecode. Instructions contain three signed 32-bit words. */
export const FORMAT_VERSION = 2;

// Existing numeric IDs are part of the serialized ABI. New instructions are appended only.
export const OpName = Object.freeze([
  'SEQ', 'CONST', 'LDLOC', 'STLOC', 'LDSTATIC', 'STSTATIC', 'LDFLD', 'STFLD', 'DUP', 'POP',
  'BINARY', 'UNARY', 'JUMP', 'JFALSE', 'JTRUE', 'CALL', 'BUILTIN', 'RET', 'NEWOBJ', 'NEWARR',
  'LDELEM', 'STELEM', 'LENGTH', 'THROW', 'RETHROW', 'CONVERT', 'NOP', 'ENDFINALLY', 'DELEGATE', 'ENUM',
  'EXTCALL', 'EXTNEWOBJ', 'EXTLDFLD', 'EXTSTFLD', 'EXTLDSTATIC', 'EXTSTSTATIC',
]);

export const Op = Object.freeze(Object.fromEntries(OpName.map((name, index) => [name, index])));
