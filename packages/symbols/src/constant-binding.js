import { Reader } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { metadataName } from './metadata-facts.js';
import { generalConstantPayload } from './constant-reader.js';

function isDecimal(metadata, token) {
  const table = token >>> 24;
  if (table !== 1 && table !== 2) return false;
  const row = metadata.row(token);
  if (table === 1 ? (row[0] & 3) === 3 : (row[0] & 7) > 1) return false;
  return (
    metadataName(metadata, row[1], 'Constant type') === 'Decimal' &&
    metadataName(metadata, row[2], 'Constant namespace') === 'System'
  );
}

function decimalValue(payload) {
  if (payload.length !== 13) fail('Decimal local constant requires exactly 13 value bytes');
  const reader = new Reader(payload);
  const flags = reader.u8();
  const scale = flags & 0x7f;
  if (scale > 28) fail('Invalid Decimal local constant scale');
  const coefficient = BigInt(reader.u32()) | (BigInt(reader.u32()) << 32n) | (BigInt(reader.u32()) << 64n);
  const negative = !!(flags & 0x80);
  const digits = coefficient.toString().padStart(scale + 1, '0');
  const magnitude = scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits;
  return { value: (negative ? '-' : '') + magnitude, decimal: { coefficient, scale, negative } };
}

/** Bind supported special constants to metadata-declared identities; no assembly resolution or PE bytes escape. */
export function bindConstantTypes(constants, metadata) {
  const decimalTypes = new Map();
  for (const constant of constants) {
    if (!constant.typeToken) continue;
    if (!decimalTypes.has(constant.typeToken))
      decimalTypes.set(constant.typeToken, isDecimal(metadata, constant.typeToken));
    if (!decimalTypes.get(constant.typeToken)) continue;
    const payload = generalConstantPayload(constant.signature, metadata.counts);
    if (payload.typeToken !== constant.typeToken) fail('Inconsistent local constant type');
    if (payload.kind !== 17) fail('Decimal local constant requires a value-type signature');
    Object.assign(constant, {
      ...decimalValue(payload.bytes),
      type: 'decimal',
      decoded: true,
      reason: null,
      enumType: null,
    });
  }
}
