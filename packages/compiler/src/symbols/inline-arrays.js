/** Inline-array layout shared by binding, conversion classification and CIL emission (C# 12, SF-A02-T80). */
import { RefKind, SymbolKind, TypeKind } from './types.js';
import { FieldSymbol } from './members.js';

const attributeName = 'System.Runtime.CompilerServices.InlineArrayAttribute';
const invalidTypeArguments = new Set([TypeKind.Pointer, TypeKind.FunctionPointer]);
const eventFields = new WeakMap();

/** The storage of a field-like event is synthesized during metadata planning; expose that same field shape. */
function eventField(event) {
  const definition = event.originalDefinition;
  let field = definition.associatedField ?? eventFields.get(definition);
  if (!field) {
    field = new FieldSymbol({
      name: definition.name, type: definition.typeWithAnnotations, containingSymbol: definition.containingType,
      modifiers: definition.modifiers, associatedSymbol: definition, isImplicitlyDeclared: true,
      syntax: definition.syntax, locations: definition.locations,
    });
    eventFields.set(definition, field);
  }
  return field.containingType === event.containingType ? field : field.asMemberOf(event.containingType);
}

/** All instance storage fields, including property/event backing fields; each emitted field counts once. */
export function inlineArrayFields(type) {
  const fields = new Map();
  for (const member of type.getMembers()) {
    let field = member.kind === SymbolKind.Field ? member : null;
    if (member.kind === SymbolKind.Property) {
      field = member.backingField ?? member.originalDefinition.backingField;
      if (field && field.containingType !== type) field = field.asMemberOf(type);
    } else if (member.kind === SymbolKind.Event && member.isFieldLike && !member.addMethod) field = eventField(member);
    if (field && !field.isStatic) fields.set(field.originalDefinition, field);
  }
  return [...fields.values()];
}

/** Whether the inline-array type and element can participate in the generic span operations the language uses. */
export function inlineArrayLanguageSupported(type, field) {
  const element = field?.type;
  if (!element || type.isRefLikeType || element.isRefLikeType || element.allowsRefLikeType) return false;
  return !invalidTypeArguments.has(element.typeKind) && (!field.refKind || field.refKind === RefKind.None);
}

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
  const fields = inlineArrayFields(type);
  const field = fields.length === 1 ? fields[0] : null;
  return field && inlineArrayLanguageSupported(definition, field) ? { field, elementType: field.type, length } : null;
}
