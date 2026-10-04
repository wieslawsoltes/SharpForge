const maximum = BigInt(Number.MAX_SAFE_INTEGER);
const minimum = -maximum;
const operations = new Map();
const signExtend = value => value;
const zeroExtend = value => value >>> 0;
const checkedUnsigned = value => value >= 0 ? value : undefined;
const conversions = new Map([
  ['conv.i8', signExtend], ['conv.u8', zeroExtend],
  ['conv.ovf.i8', signExtend], ['conv.ovf.i8.un', zeroExtend],
  ['conv.ovf.u8', checkedUnsigned], ['conv.ovf.u8.un', zeroExtend]
]);

for (const [name, calculate] of [['add', (left, right) => left + right],
  ['sub', (left, right) => left - right], ['mul', (left, right) => left * right]]) {
  const signed = (left, right) => {
    const result = calculate(left, right);
    return Number.isSafeInteger(result) ? result || 0 : undefined;
  };
  operations.set(name, signed);
  operations.set(name + '.ovf', signed);
  operations.set(name + '.ovf.un', (left, right) => {
    // Negative signed patterns represent large UInt64 values, not small unsigned operands.
    if (left < 0 || right < 0) return undefined;
    const result = signed(left, right);
    return result >= 0 ? result : undefined;
  });
}

/** Convert only exact safe BigInt values; a plain Number never implies Int64 at a public boundary. */
export function smallLongNumber(value) {
  return typeof value === 'bigint' && value >= minimum && value <= maximum ? Number(value) : undefined;
}

/** Private tagged operands are safe integers. Undefined requests the unchanged BigInt handler before any pop. */
export function smallLongOperation(name) {
  return operations.get(name) ?? null;
}

/** Canonical Int32 inputs widen exactly; undefined preserves the shared checked-conversion fault path. */
export function smallLongConversion(name) {
  return conversions.get(name) ?? null;
}

/** Safe signed patterns preserve UInt64 ordering by putting negative patterns after nonnegative ones. */
export function compareSmallLong(left, right, unsigned) {
  if (unsigned && (left < 0) !== (right < 0)) return left < 0 ? 1 : -1;
  return left < right ? -1 : left > right ? 1 : 0;
}
