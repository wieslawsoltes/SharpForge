/** ECMA-335 II.22 structural constraints that do not require assembly/type resolution. */
export const requiredColumns = Object.freeze({
  0: [1, 2], 1: [1], 2: [1], 3: [0], 4: [1, 2], 5: [0], 6: [3, 4], 7: [0],
  9: [0, 1], 10: [0, 1, 2], 11: [1, 2], 12: [0, 1, 2], 13: [0, 1], 14: [1, 2],
  15: [2], 16: [1], 17: [0], 18: [0], 19: [0], 20: [1, 2], 21: [0], 22: [0],
  23: [1, 2], 24: [1, 2], 25: [0, 1, 2], 26: [0], 27: [0], 28: [1, 2, 3], 29: [1],
  32: [7], 35: [6], 36: [1], 37: [3], 38: [1, 2], 39: [2, 4], 40: [2],
  41: [0, 1], 42: [2], 43: [0, 1], 44: [0, 1], 48: [0], 54: [0, 1], 55: [0, 1, 2],
});

export const uniqueKeys = Object.freeze({
  3: [0], 5: [0], 7: [0], 9: [0, 1], 11: [1], 13: [0], 14: [0, 1], 15: [2], 16: [1],
  18: [0], 19: [0], 21: [0], 22: [0], 24: [0, 1, 2], 25: [0, 1, 2], 26: [0],
  28: [1], 29: [1], 31: [0], 38: [1], 40: [2], 41: [0], 42: [2, 0], 44: [0, 1], 54: [0],
});

export const flagColumns = Object.freeze({
  2: [0, 0x00f77dbf], 4: [0, 0xb7f7], 6: [2, 0xffff], 8: [0, 0x3013],
  20: [0, 0x600], 23: [0, 0x1600], 24: [0, 0x3f], 28: [0, 0x3777],
  32: [5, 0xcf71], 35: [4, 0xcf71], 38: [0, 1], 40: [1, 7], 42: [1, 0x1f], 51: [0, 1],
});

export const rowRules = Object.freeze({
  0: row => row[0] !== 0 ? 'Module Generation must be zero in a complete image' : null,
  2: row => {
    if ((row[0] & 0x18) === 0x18) return 'TypeDef has incompatible layout flags';
    if ((row[0] & 0x20) && !(row[0] & 0x80)) return 'An interface must be abstract';
    if ((row[0] & 0x20) && (row[0] & 0x100)) return 'An interface cannot be sealed';
    return null;
  },
  4: row => {
    if ((row[0] & 7) === 7) return 'Field has invalid access flags';
    if ((row[0] & 0x40) && !(row[0] & 0x10)) return 'A literal field must be static';
    if ((row[0] & 0x60) === 0x60) return 'A literal field cannot be initonly';
    return null;
  },
  6: row => {
    if ((row[2] & 7) === 7) return 'MethodDef has invalid access flags';
    if ((row[2] & 0x400) && (!(row[2] & 0x40) || (row[2] & 0x10))) return 'An abstract method must be virtual and instance';
    if ((row[2] & 0x400) && row[0]) return 'An abstract method cannot have a body RVA';
    if ((row[2] & 0x50) === 0x50) return 'A static method cannot be virtual';
    if ((row[1] & ~0x13ff) !== 0) return 'MethodDef has undefined implementation flags';
    return null;
  },
  11: row => ![2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18].includes(row[0]) ? 'Invalid Constant element type' : null,
  14: row => row[0] < 1 || row[0] > 15 ? 'Invalid declarative security action' : null,
  15: row => ![0, 1, 2, 4, 8, 16, 32, 64, 128].includes(row[0]) ? 'Invalid ClassLayout packing size' : null,
  24: row => ![1, 2, 4, 8, 16, 32].includes(row[0]) ? 'MethodSemantics requires exactly one semantic flag' : null,
  28: row => (row[0] & 0x700) > 0x500 ? 'Invalid P/Invoke calling convention' : null,
  40: row => ![1, 2].includes(row[1] & 7) ? 'Invalid manifest resource visibility' : null,
  41: row => row[0] <= row[1] ? 'An enclosing TypeDef must precede its nested type' : null,
  42: row => (row[1] & 3) === 3 ? 'Generic variance flags are mutually exclusive' : null,
});
