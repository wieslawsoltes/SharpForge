import { decodeCoded, decodeSignature } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { metadataName } from './metadata-facts.js';

const scalarTypes = new Set(['bool', 'char', 'sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong']);

function fieldCount(metadata, token) {
  const row = token & 0xffffff;
  const target = metadata.uncompressed && Object.hasOwn(metadata.counts, 3) ? 3 : 4;
  const maximum = (metadata.counts[target] ?? 0) + 1;
  const start = metadata.row(token)[4];
  const end = metadata.rows[2]?.[row]?.[4] ?? maximum;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > maximum)
    fail('Invalid enum field list range');
  return end - start;
}

function enumTypes(constants, metadata) {
  const types = new Map();
  let fields = 0;
  for (const constant of constants) {
    const token = constant.enumTypeToken;
    if (token >>> 24 !== 2 || types.has(token)) continue;
    if (types.size >= 1024) fail('Local enum type count limit exceeded');
    const count = fieldCount(metadata, token);
    if (count > 4096 || (fields += count) > 65536) fail('Local enum field count limit exceeded');
    types.set(token, null);
  }
  return types;
}

function underlyingType(metadata, token, state) {
  let result;
  for (const field of metadata.list(token, 'FieldList')) {
    if (field >>> 24 !== 4 || !(field & 0xffffff) || (field & 0xffffff) > (metadata.counts[4] ?? 0))
      fail('Invalid enum field token');
    if (state.fields.has(field)) fail('Ambiguous enum field ownership');
    state.fields.add(field);
    const row = metadata.row(field);
    if (row[0] & 0x10) continue;
    if (result || (row[0] & 0x600) !== 0x600 || metadataName(metadata, row[1], 'Enum field') !== 'value__')
      fail('Local enum requires one special value__ instance field');
    const bytes = metadata.blob(row[2]);
    if (bytes.length > 4096 || (state.bytes += bytes.length) > 1024 * 1024)
      fail('Local enum field signature byte limit exceeded');
    const signature = decodeSignature(bytes, { maxDepth: 32, maxNodes: 256 });
    let type = signature.type;
    while (type?.kind === 'modreq' || type?.kind === 'modopt') type = type.element;
    if (signature.kind !== 'field' || type?.kind !== 'primitive' || !scalarTypes.has(type.name))
      fail('Unsupported local enum underlying field type');
    result = type.name;
  }
  if (!result) fail('Local enum requires one special value__ instance field');
  return result;
}

/** Check local enum scalar kinds once per definition; external enum identities stay unverified. */
export function bindEnumConstants(constants, metadata, namedType) {
  const types = enumTypes(constants, metadata);
  if (!types.size) return;
  const state = { fields: new Set(), bytes: 0 };
  for (const token of types.keys()) {
    const base = decodeCoded('TypeDefOrRef', metadata.row(token)[3]);
    if (!base || namedType(base) !== 'Enum')
      fail('Unsupported local enum base: declared framework System.Enum required');
    types.set(token, underlyingType(metadata, token, state));
  }
  for (const constant of constants) {
    const underlying = types.get(constant.enumTypeToken);
    if (!underlying) continue;
    if (constant.type !== underlying) fail('Local enum constant scalar kind does not match its underlying field');
    constant.enumTypeVerified = true;
  }
}
