import {
  Op,
  numericTypeId,
  numericTypeName, sourceNullableElement
} from '@sharpforge/bytecode';
import {
  decodeCoded
} from './metadata.js';
import {
  CilError
} from './binary.js';

/** Source value descriptors derive their category and layout from the TypeDef base and flags. */
export function loadSourceTypeShape(metadata, row) {
  if (row[0] & 0x20) {
    if (!(row[0] & 0x80) || row[3]) throw new CilError('Invalid source interface flags or base');
    return {interface: true, abstract: true};
  }
  const baseToken = decodeCoded('TypeDefOrRef', row[3]);
  if (!baseToken || metadata.typeName(baseToken) !== 'System.ValueType') return {};
  if ((row[0] & 0x18) !== 8 || !(row[0] & 0x100)) throw new CilError('Source structs require sealed sequential value layout');
  return {
    valueType: true,
    base: 'System.ValueType'
  };
}

/** Match the complete source value conversion span; canonical re-emission checks its surrounding metadata. */
export function decodeSourceValueSpan(span, context) {
  if (span.length !== 2 || span[1].name !== 'nop' || !['box', 'unbox.any'].includes(span[0].name)) return null;
  const type = context.typeByToken.get(span[0].operand);
  const tokenName = context.metadata.typeName(span[0].operand);
  const name = type?.name ?? (tokenName === 'System.Boolean' ? 'bool' : numericTypeName(tokenName) ?? tokenName);
  if (!type?.valueType && !sourceNullableElement(name) && numericTypeId(name) === undefined && name !== 'bool') return null;
  return [span[0].name === 'box' ? Op.BOX : Op.UNBOXANY, context.intern(name), 0];
}
