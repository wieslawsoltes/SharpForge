import { Reader } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { generalConstantPayload } from './constant-reader.js';
import { createFrameworkTypeResolver } from './framework-type-identity.js';
import { constantTypeSpecs, nullableTypeSpec } from './nullable-constant.js';
import { bindEnumConstants } from './enum-constant.js';

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

function dateTimeValue(payload) {
  if (payload.length !== 8) fail('DateTime local constant requires exactly 8 value bytes');
  const ticks = new Reader(payload).i64();
  if (ticks < 0n || ticks > 3155378975999999999n) fail('DateTime local constant ticks are outside the supported range');
  return { value: ticks, dateTime: { ticks, kind: 'unspecified' } };
}

const specialTypes = Object.freeze({
  Decimal: Object.freeze({ name: 'Decimal', type: 'decimal', decode: decimalValue }),
  DateTime: Object.freeze({ name: 'DateTime', type: 'datetime', decode: dateTimeValue }),
  'Nullable`1': Object.freeze({
    name: 'Nullable',
    type: 'nullable',
    emptyPayload: true,
    decode: () => ({ value: null }),
  }),
});

/** Bind supported special constants to metadata-declared identities; no assembly resolution or PE bytes escape. */
export function bindConstantTypes(constants, metadata) {
  const types = new Map();
  const specs = constantTypeSpecs(constants, metadata);
  const resolveNamed = createFrameworkTypeResolver(
    metadata,
    (name) => Object.hasOwn(specialTypes, name) || name === 'Enum',
  );
  bindEnumConstants(constants, metadata, resolveNamed);
  for (const constant of constants) {
    if (!constant.typeToken) continue;
    if (!types.has(constant.typeToken)) {
      const spec = specs?.get(constant.typeToken);
      const name = spec
        ? nullableTypeSpec(spec, resolveNamed)
          ? 'Nullable`1'
          : null
        : resolveNamed(constant.typeToken);
      const type = name === 'Nullable`1' && !spec ? null : specialTypes[name];
      types.set(constant.typeToken, type);
    }
    const type = types.get(constant.typeToken);
    if (!type) continue;
    const payload = generalConstantPayload(constant.signature, metadata.counts);
    if (payload.typeToken !== constant.typeToken) fail('Inconsistent local constant type');
    if (payload.kind !== 17) fail(`${type.name} local constant requires a value-type signature`);
    // The general format does not define an encoding for a present Nullable<T> value.
    if (type.emptyPayload && payload.bytes.length) continue;
    Object.assign(constant, {
      ...type.decode(payload.bytes),
      type: type.type,
      decoded: true,
      reason: null,
      enumType: null,
    });
  }
}
