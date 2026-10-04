/** Ordered scalar overloads; registration order is part of the appended A09 contract ABI. */
export const writerScalarTypes = Object.freeze(['bool', 'int', 'uint', 'long', 'ulong', 'float', 'double', 'decimal']);

const scalarTypes = new Set(writerScalarTypes);

/** Identify the exact scalar overloads whose formatting is provided by typed StringBuilder.Append. */
export function isWriterScalar(type) {
  return scalarTypes.has(type);
}

/** Append scalar writer contracts after every released reader/writer slot. */
export function registerWriterScalars({member}) {
  for (const name of ['Write', 'WriteLine']) {
    for (const type of writerScalarTypes) member('System.IO.TextWriter', name, [type], 'void');
  }
}
