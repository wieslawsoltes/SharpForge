/**
 * C# 14 extension blocks imported from their grouping and marker metadata (SF-A02-T83).
 *
 * Grouping members only describe the source declaration; their bodies throw. Lookup must instead return the
 * original MethodDef on the enclosing static class, including its flattened generic parameters and modifiers.
 * This reader runs once, lazily, for classes already marked as possible extension containers. Members are indexed
 * by marker name, and implementations by complete signature and constraints, before checking candidate symbols.
 *
 * Metadata contract: dotnet/csharplang, proposals/csharp-14.0/extensions.md, "Metadata representation".
 */
import { Accessibility, SymbolKind, TypeKind, TypeCompareKind, TypeMap } from '../symbols/types.js';
import { MethodKind, ParameterSymbol, PropertySymbol } from '../symbols/members.js';
import { decodeAttributeBlob } from './attributes.js';
import { ElementType, Table, tokenOf, ridOf, parseMethodSignature } from './pe-metadata.js';
import { attachSignatureModifiers } from './signature-modifiers.js';
import { ExtensionImplementationIndex, extensionConstraintFlags } from './extension-signatures.js';

const extensionAttribute = 'System.Runtime.CompilerServices.ExtensionAttribute';
// The original proposal used ExtensionMarkerNameAttribute; .NET 10 ships ExtensionMarkerAttribute.
const markerAttributes = new Set([
  'System.Runtime.CompilerServices.ExtensionMarkerAttribute',
  'System.Runtime.CompilerServices.ExtensionMarkerNameAttribute',
]);
const specialTypeName = 0x400;
const staticMethod = 0x10;
const specialMethodName = 0x800;
const signatureCompare = TypeCompareKind.IgnoreDynamic | TypeCompareKind.IgnoreTupleNames |
  TypeCompareKind.IgnoreNullableModifiersForReferenceTypes | TypeCompareKind.IgnoreNativeIntegers;

function attributesOf(symbol) {
  const assembly = symbol.containingAssembly ?? symbol.containingType?.containingAssembly;
  return assembly?.metadata.customAttributes(symbol.metadataToken) ?? [];
}

function hasExtensionAttribute(symbol) {
  return attributesOf(symbol).some(attribute => attribute.fullName === extensionAttribute && !attribute.parameterTypes.length &&
    !decodeAttributeBlob(attribute.blob, []).hasErrors);
}

function markerNameOf(symbol) {
  const attributes = attributesOf(symbol).filter(attribute => markerAttributes.has(attribute.fullName));
  if (attributes.length !== 1) return null;
  const attribute = attributes[0];
  if (attribute.parameterTypes.length !== 1 || attribute.parameterTypes[0].code !== ElementType.String) return null;
  const decoded = decodeAttributeBlob(attribute.blob, attribute.parameterTypes);
  const name = decoded.constructorArguments[0]?.value;
  return !decoded.hasErrors && typeof name === 'string' && name.length ? name : null;
}

function isMetadataContainer(type) {
  const flags = type.containingAssembly.metadata.row(Table.TypeDef, ridOf(type.metadataToken))[0];
  return !!(flags & specialTypeName) && type.declaredAccessibility === Accessibility.Public &&
    type.typeKind === TypeKind.Class && type.baseType?.specialType === 'System_Object' && !type.interfaces.length;
}

function isGroupingType(type) {
  return isMetadataContainer(type) && type.isSealed && hasExtensionAttribute(type);
}

/** The marker redeclares the group's generic parameters with their C# constraints (for example unmanaged). */
function markerTypeParameters(marker, group) {
  const assembly = marker.containingAssembly;
  const rows = assembly.metadata.genericParameters(marker.metadataToken);
  if (marker.arity || rows.length !== group.arity || rows.some((row, index) => row.number !== index)) return null;
  const context = { type: { _allTypeParameters: [] }, methodTypeParameters: [] };
  const parameters = rows.map(row => assembly._typeParameter(row, context, marker.nullableContext));
  context.type._allTypeParameters = parameters;
  return parameters;
}

/** Read the single marker method even when it is private, without publishing it as a callable member. */
function markerReceiver(marker) {
  const assembly = marker.containingAssembly;
  const metadata = assembly.metadata;
  const [start, end] = metadata.listRange(Table.TypeDef, ridOf(marker.metadataToken), 5, Table.MethodDef);
  let methodRid = 0;
  for (let rid = start; rid < end; rid++) {
    const row = metadata.row(Table.MethodDef, rid);
    if ((row[2] & (staticMethod | specialMethodName)) !== (staticMethod | specialMethodName) ||
      metadata.string(row[3]) !== '<Extension>$') continue;
    if (methodRid) return null;
    methodRid = rid;
  }
  if (!methodRid || metadata.genericParameters(tokenOf(Table.MethodDef, methodRid)).length) return null;
  const signature = parseMethodSignature(metadata.blob(metadata.row(Table.MethodDef, methodRid)[4]));
  if (signature.hasThis || signature.callingConvention !== 0 || signature.genericArity || signature.parameters.length !== 1 ||
    signature.returnType.kind !== 'primitive' || signature.returnType.code !== ElementType.Void) return null;
  const [parameterStart, parameterEnd] = metadata.listRange(Table.MethodDef, methodRid, 5, Table.Param);
  let parameterToken = 0;
  let parameterRow = null;
  for (let rid = parameterStart; rid < parameterEnd; rid++) {
    const row = metadata.row(Table.Param, rid);
    if (row[1] !== 1) continue;
    if (parameterRow) return null;
    parameterRow = row;
    parameterToken = tokenOf(Table.Param, rid);
  }
  const context = { type: marker, methodTypeParameters: [] };
  const slot = assembly._slot(signature.parameters[0], context, parameterToken, marker.nullableContext, {
    flags: parameterRow?.[0] ?? 0,
  });
  const receiver = new ParameterSymbol({
    name: parameterRow ? metadata.string(parameterRow[2]) : '', type: slot.type, refKind: slot.refKind,
    attributes: parameterToken ? assembly._attributes(parameterToken) : [],
  });
  receiver.metadataToken = parameterToken;
  attachSignatureModifiers({ parameters: [receiver] }, signature, token => assembly._typeFromToken(token, context));
  return receiver;
}

function sameModifiers(left, right, map) {
  return ['outer', 'inner'].every(position => {
    const source = left?.[position] ?? [];
    const target = right?.[position] ?? [];
    return source.length === target.length && source.every((modifier, index) =>
      modifier.isOptional === target[index].isOptional &&
      map.substituteType(modifier.type).type.equals(target[index].type, signatureCompare));
  });
}

function sameParameter(source, target, map) {
  return source.refKind === target.refKind && source.typeWithAnnotations.substitute(map).equals(target.typeWithAnnotations, signatureCompare) &&
    sameModifiers(source.customModifiers, target.customModifiers, map);
}

function sameConstraints(source, target, map) {
  return source.every((parameter, index) => {
    const candidate = target[index];
    if (extensionConstraintFlags.some(flag => parameter[flag] !== candidate[flag])) return false;
    const constraints = parameter.constraintTypes.map(type => type.substitute(map));
    const other = candidate.constraintTypes;
    return constraints.length === other.length && constraints.every(type => other.some(value => type.equals(value, signatureCompare)));
  });
}

/** An exact signature and constraint match; ambiguity in malformed metadata is not an extension declaration. */
function implementationOf(declaration, block, implementations) {
  const additional = declaration.isStatic ? 0 : 1;
  const parameters = [...block.group.typeParameters, ...declaration.typeParameters];
  const matches = [];
  for (const candidate of implementations.candidates(declaration, block)) {
    if (candidate.declaredAccessibility !== declaration.declaredAccessibility || candidate.isVararg !== declaration.isVararg) continue;
    const map = new TypeMap(parameters, candidate.typeParameters)
      .with(block.typeParameters, candidate.typeParameters.slice(0, block.typeParameters.length));
    if (candidate.refKind !== declaration.refKind ||
      !declaration.returnTypeWithAnnotations.substitute(map).equals(candidate.returnTypeWithAnnotations, signatureCompare) ||
      !sameModifiers(declaration.returnCustomModifiers, candidate.returnCustomModifiers, map)) continue;
    if (additional && !sameParameter(block.receiver, candidate.parameters[0], map)) continue;
    if (!declaration.parameters.every((parameter, index) => sameParameter(parameter, candidate.parameters[index + additional], map))) continue;
    if (!sameConstraints([...block.typeParameters, ...declaration.typeParameters], candidate.typeParameters, map)) continue;
    matches.push({ method: candidate, receiver: block.receiver.substitute(map, candidate) });
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? matches[0] : null;
}

function attachReceiver(match) {
  match.method.extensionReceiver = match.receiver;
  match.method.extensionReceiverType = match.receiver.type;
  return match.method;
}

function propertyOf(declaration, block, implementations) {
  const getter = declaration.getMethod && markerNameOf(declaration.getMethod) === block.marker.metadataName
    ? implementationOf(declaration.getMethod, block, implementations) : null;
  const setter = declaration.setMethod && markerNameOf(declaration.setMethod) === block.marker.metadataName
    ? implementationOf(declaration.setMethod, block, implementations) : null;
  // A missing visible implementation must not turn a read/write property into a different declaration.
  if (declaration.getMethod && !getter || declaration.setMethod && !setter) return null;
  const primary = getter ?? setter;
  if (!primary) return null;
  const method = primary.method;
  const property = new PropertySymbol({
    name: declaration.name,
    type: getter ? method.returnTypeWithAnnotations : method.parameters.at(-1).typeWithAnnotations,
    refKind: declaration.refKind,
    parameters: (getter ? method.parameters : method.parameters.slice(0, -1))
      .slice(declaration.isStatic ? 0 : 1).map(parameter => parameter.substitute(TypeMap.empty, null)),
    containingSymbol: method.containingSymbol,
    declaredAccessibility: declaration.declaredAccessibility,
    modifiers: declaration.modifiers,
    obsolete: declaration.obsolete,
    attributes: declaration.attributes,
  });
  // These are ordinary implementation MethodDefs, not CLR property accessors; keep their identity/association.
  property.getMethod = getter ? attachReceiver(getter) : null;
  property.setMethod = setter ? attachReceiver(setter) : null;
  property.isExtensionProperty = true;
  property.extensionReceiverType = primary.receiver.type;
  return property;
}

function membersByMarker(group) {
  const index = new Map();
  for (const member of group.getMembers()) {
    if (member.kind !== SymbolKind.Property && (member.kind !== SymbolKind.Method || member.isAccessor || member.isConstructor)) continue;
    const name = markerNameOf(member);
    if (!name) continue;
    const members = index.get(name) ?? [];
    members.push(member);
    index.set(name, members);
  }
  return index;
}

/** Restores lookup entries for valid imported blocks; unrelated or malformed patterns supply no extension members. */
export function readImportedExtensionMembers(type) {
  if (!type.mightContainExtensionMethods || !hasExtensionAttribute(type)) return Object.freeze([]);
  const groups = type.getTypeMembers().filter(isGroupingType);
  if (!groups.length) return Object.freeze([]);
  const implementations = new ExtensionImplementationIndex(type);
  const result = [];
  for (const group of groups) {
    const declarations = membersByMarker(group);
    for (const marker of group.getTypeMembers()) {
      if (!isMetadataContainer(marker) || !marker.isStatic) continue;
      const typeParameters = markerTypeParameters(marker, group);
      if (!typeParameters) continue;
      const receiver = markerReceiver(marker);
      if (!receiver) continue;
      const block = { group, marker, typeParameters, receiver };
      for (const declaration of declarations.get(marker.metadataName) ?? []) {
        let symbol;
        let kind = declaration.isStatic ? 'static' : 'instance';
        if (declaration.kind === SymbolKind.Property) symbol = propertyOf(declaration, block, implementations);
        else {
          const match = implementationOf(declaration, block, implementations);
          symbol = match ? attachReceiver(match) : null;
          if (declaration.methodKind === MethodKind.UserDefinedOperator || declaration.methodKind === MethodKind.Conversion)
            kind = declaration.isStatic ? 'operator' : 'instanceOperator';
        }
        if (symbol) result.push(Object.freeze({ name: declaration.name, kind, symbol }));
      }
    }
  }
  return Object.freeze(result);
}
