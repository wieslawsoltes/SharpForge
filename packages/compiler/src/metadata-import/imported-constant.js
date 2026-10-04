/**
 * The constant of a field imported from metadata, as the typed `ConstantValue` the binder folds with.
 *
 * The importer keeps the decoded Constant row (`field.constantValue` is a number, bigint, string, boolean or null);
 * the type of the constant is the type of the field: a predefined type, or an enum whose members are constants of
 * its underlying type.
 */
import { TypeKind } from '../symbols/types.js';
import { ConstantValue } from '../constants/constant-value.js';

const constantKinds = Object.freeze({
  System_Boolean: 'bool',
  System_Char: 'char',
  System_SByte: 'sbyte',
  System_Byte: 'byte',
  System_Int16: 'short',
  System_UInt16: 'ushort',
  System_Int32: 'int',
  System_UInt32: 'uint',
  System_Int64: 'long',
  System_UInt64: 'ulong',
  System_Single: 'float',
  System_Double: 'double',
  System_String: 'string',
});

/** The constant-value discriminator of a predefined type, or null. */
const kindOf = type => constantKinds[type?.specialType] ?? null;

/** A character constant is stored as its UTF-16 code unit; the reader may hand it over as a one-character string. */
const integralValue = raw => (typeof raw === 'string' ? raw.charCodeAt(0) : typeof raw === 'boolean' ? Number(raw) : raw);

/**
 * @param field an imported const field (`hasConstantValue`)
 * @returns {ConstantValue|null} null when the field has no constant or its type cannot hold one the compiler folds
 *   (a `decimal` or `DateTime` constant is an attribute in metadata, not a Constant row)
 */
export function importedConstant(field) {
  if (!field?.hasConstantValue) return null;
  const raw = field.constantValue,
    type = field.type;
  if (raw instanceof ConstantValue) return raw;
  if (type?.typeKind === TypeKind.Enum) {
    const underlying = kindOf(type.enumUnderlyingType) ?? 'int';
    return raw === null || raw === undefined ? null : ConstantValue.integral(underlying, integralValue(raw), type);
  }
  const kind = kindOf(type);
  if (raw === null || raw === undefined) return type?.isReferenceType === true ? ConstantValue.null(kind ?? 'null') : null;
  if (!kind) return null;
  if (kind === 'string' || kind === 'float' || kind === 'double') return ConstantValue.of(kind, raw);
  if (kind === 'bool') return ConstantValue.bool(!!raw);
  return ConstantValue.of(kind, integralValue(raw));
}
