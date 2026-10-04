/** Constant-table encodings shared by fields and optional parameters (ECMA-335 II.22.9). */
const elementTypes = Object.freeze({
  bool: 2, char: 3, sbyte: 4, byte: 5, short: 6, ushort: 7, int: 8, uint: 9,
  long: 10, ulong: 11, float: 12, double: 13, string: 14,
});

export const NULL_REFERENCE_CONSTANT = 18;

/** Returns the CLI element type, or undefined for constants represented by attributes (decimal). */
export function constantTypeOf(constant) {
  if (constant.value === null || constant.isNull) return NULL_REFERENCE_CONSTANT;
  return elementTypes[constant.type];
}

/** The metadata writer takes a UTF-16 character, while compiler constants retain its numeric code unit. */
export function constantRowValue(constant) {
  if (constant.isNull) return null;
  return constant.type === 'char' && typeof constant.value !== 'string'
    ? String.fromCharCode(Number(constant.value))
    : constant.value;
}
