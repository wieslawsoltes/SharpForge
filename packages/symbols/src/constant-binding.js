import { Reader, decodeCoded } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { metadataName } from './metadata-facts.js';
import { generalConstantPayload } from './constant-reader.js';
import { hex, sha1 } from './hash.js';
import { constantTypeSpecs, nullableTypeSpec } from './nullable-constant.js';

const frameworkTokens = Object.freeze({
  'System.Runtime': 'b03f5f7f11d50a3a',
  'System.Private.CoreLib': '7cec85d7bea7798e',
  mscorlib: 'b77a5c561934e089',
});

function frameworkAssembly(metadata, scope, state) {
  if (state.assemblies.has(scope)) return state.assemblies.get(scope);
  if (state.assemblies.size >= 1024) fail('Constant assembly identity limit exceeded');
  const definition = scope >>> 24 === 32;
  const row = metadata.row(scope);
  const shift = definition ? 1 : 0;
  const name = metadataName(metadata, row[6 + shift], 'Constant assembly');
  const expected = Object.hasOwn(frameworkTokens, name) ? frameworkTokens[name] : null;
  let matched = false;
  if (expected && metadataName(metadata, row[7 + shift], 'Constant assembly culture') === '') {
    const flags = row[4 + shift];
    const key = metadata.blob(row[5 + shift]);
    if (key.length > 16384 || (state.keyBytes += key.length) > 1024 * 1024) {
      fail('Constant assembly key byte limit exceeded');
    }
    const fullKey = !!(flags & 1);
    if (!(flags & ~0x101) && (fullKey ? key.length >= 16 : !definition && key.length === 8)) {
      const token = fullKey ? sha1(key).subarray(12).reverse() : key;
      matched = hex(token) === expected;
    }
  }
  state.assemblies.set(scope, matched);
  return matched;
}

function namedType(metadata, token, state) {
  const table = token >>> 24;
  if (table !== 1 && table !== 2) return null;
  const row = metadata.row(token);
  if (table === 1 ? (row[0] & 3) === 3 : (row[0] & 7) > 1) return null;
  const name = metadataName(metadata, row[1], 'Constant type');
  if (!Object.hasOwn(specialTypes, name) || metadataName(metadata, row[2], 'Constant namespace') !== 'System')
    return null;
  let scope = table === 1 ? decodeCoded('ResolutionScope', row[0]) : 0x20000001;
  if (scope === 1) scope = 0x20000001;
  if (scope >>> 24 !== 35 && scope !== 0x20000001) return null;
  if (scope === 0x20000001 && metadata.rows[32]?.length !== 1) return null;
  return frameworkAssembly(metadata, scope, state) ? name : null;
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
  const state = { assemblies: new Map(), keyBytes: 0 };
  const specs = constantTypeSpecs(constants, metadata);
  const resolveNamed = (token) => namedType(metadata, token, state);
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
