/** The CLI value-type constraint and C# marker that together preserve an unmanaged generic constraint. */
import { typeDefOrRefEncoded } from '../generics.js';
import { encodeCustomAttribute } from '@sharpforge/cil';
import { markerAttributeContract } from './compiler-attribute-symbols.js';
import { compilerAttributeConstructorToken } from './compiler-attribute-definitions.js';

const UNMANAGED_TYPE = 'System.Runtime.InteropServices.UnmanagedType';
const IS_UNMANAGED = 'System.Runtime.CompilerServices.IsUnmanagedAttribute';
const REQUIRED_MODIFIER = 0x1f;
const CLASS = 0x12;

/** Register every source, synthesized and cloned generic declaration before TypeDef order is fixed. */
export function planUnmanagedAttributes(registry, plans) {
  for (const [type, plan] of plans) {
    const parameters = [...(plan.metadataTypeParameters ?? type.typeParameters),
      ...plan.methods.flatMap(method => method.symbol?.typeParameters ?? [])];
    if (parameters.some(parameter => parameter.hasUnmanagedTypeConstraint)) {
      registry.getOrCreate(IS_UNMANAGED, (analysis, existing) =>
        markerAttributeContract(analysis, existing, { fullName: IS_UNMANAGED }));
      return;
    }
  }
}

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
  const contract = attributes.writer.compilerAttributes.get(IS_UNMANAGED);
  if (!contract) return;
  const constructor = compilerAttributeConstructorToken(attributes, contract);
  for (const row of attributes.writer.genericParameterRows) {
    if (row.symbol.hasUnmanagedTypeConstraint) attributes.add(row.token, constructor, encodeCustomAttribute([], []));
  }
}
