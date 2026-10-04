/** Inline-array layout shared by binding, conversion classification and CIL emission (C# 12, SF-A02-T80). */
import { SymbolKind, TypeKind } from './types.js';

const attributeName = 'System.Runtime.CompilerServices.InlineArrayAttribute';

function sourceLength(type) {
  for (const attribute of type.boundAttributes ?? []) {
    const owner = attribute.attributeClass;
    if (owner?.name !== 'InlineArrayAttribute' || owner.containingNamespace?.toDisplayString() !== 'System.Runtime.CompilerServices') continue;
    return attribute.arguments[0]?.constantValue?.value;
  }
  return null;
}

function importedLength(type) {
  const attribute = type.attributes?.find(candidate => candidate.attributeClassName === attributeName && !candidate.hasErrors);
  return attribute?.constructorArguments[0]?.value ?? null;
}

/**
 * The single instance field, substituted element type and positive Int32 length of an inline-array struct.
 * Returns null for another type or malformed layout. Source and reference-assembly symbols use the same shape.
 */
export function inlineArrayShape(type) {
  const definition = type?.originalDefinition ?? type;
  if (definition?.typeKind !== TypeKind.Struct) return null;
  const length = definition.isSource ? sourceLength(definition) : importedLength(definition);
  if (!Number.isInteger(length) || length <= 0 || length > 0x7fffffff) return null;
  let field = null;
  for (const member of type.getMembers()) {
    if (member.kind !== SymbolKind.Field || member.isStatic || member.isImplicitlyDeclared) continue;
    if (field) return null;
    field = member;
  }
  return field ? { field, elementType: field.type, length } : null;
}
