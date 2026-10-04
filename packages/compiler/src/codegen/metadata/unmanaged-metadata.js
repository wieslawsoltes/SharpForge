/** The CLI value-type constraint and C# marker that together preserve an unmanaged generic constraint. */
import { typeDefOrRefEncoded } from '../generics.js';

const UNMANAGED_TYPE = 'System.Runtime.InteropServices.UnmanagedType';
const IS_UNMANAGED = 'System.Runtime.CompilerServices.IsUnmanagedAttribute';
const REQUIRED_MODIFIER = 0x1f;
const CLASS = 0x12;

/** `modreq(UnmanagedType) System.ValueType`; all unmanaged parameters in one writer share its TypeSpec. */
export function valueTypeConstraintToken(writer, parameter) {
  const valueType = writer.tokens.definitionToken(writer.core.valueType);
  if (!parameter.hasUnmanagedTypeConstraint) return valueType;
  if (writer.unmanagedConstraintToken !== undefined) return writer.unmanagedConstraintToken;
  const assembly = writer.tokens.assemblyOf({}, UNMANAGED_TYPE);
  const modifier = writer.builder.typeRef(UNMANAGED_TYPE, assembly);
  const signature = Uint8Array.from([REQUIRED_MODIFIER, ...typeDefOrRefEncoded(modifier), CLASS, ...typeDefOrRefEncoded(valueType)]);
  writer.unmanagedConstraintToken = writer.builder.addRow('TypeSpec', { Signature: signature });
  return writer.unmanagedConstraintToken;
}

/** Both metadata pieces are necessary: the modifier protects older compilers, the attribute denotes C# unmanaged. */
export function writeUnmanagedAttributes(attributes) {
  for (const row of attributes.writer.genericParameterRows) {
    if (row.symbol.hasUnmanagedTypeConstraint) attributes.wellKnown(row.token, IS_UNMANAGED);
  }
}
