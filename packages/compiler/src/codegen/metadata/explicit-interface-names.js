import { SymbolKind, TypeKind } from '../../symbols/types.js';
import { MetadataEmitError, namespaceOf } from './type-tokens.js';

function interfaceTypeName(type, depth = 0) {
  if (depth > 256) throw new MetadataEmitError('Explicit interface name exceeds 256 type levels');
  if (type.typeKind === TypeKind.Dynamic) return 'System.Object';
  if (type.typeKind === TypeKind.TypeParameter) return type.name;
  if (type.typeKind === TypeKind.Array) {
    let ranks = '';
    while (type.typeKind === TypeKind.Array) {
      if (++depth > 256) throw new MetadataEmitError('Explicit interface array name exceeds 256 type levels');
      ranks += type.isSZArray ? '[]' : '[' + (type.rank === 1 ? '*' : ','.repeat(type.rank - 1)) + ']';
      type = type.elementType;
    }
    return interfaceTypeName(type, depth) + ranks;
  }
  if (type.typeKind === TypeKind.Pointer) return interfaceTypeName(type.pointedAtType, depth + 1) + '*';
  if (type.kind !== SymbolKind.NamedType) throw new MetadataEmitError('Unsupported explicit interface type name: ' + type.typeKind);
  const outer = type.containingType;
  const namespace = outer ? '' : namespaceOf(type);
  const prefix = outer ? interfaceTypeName(outer, depth + 1) + '.' : namespace ? namespace + '.' : '';
  const typeArguments = type.typeArguments.map(argument => interfaceTypeName(argument.type, depth + 1));
  return prefix + type.name + (typeArguments.length ? '<' + typeArguments.join(',') + '>' : '');
}

/** The resolved interface named by an explicit method, property or event, including an accessor's owner. */
export function explicitInterfaceOf(member) {
  return member.explicitInterfaceType ?? member.associatedSymbol?.explicitInterfaceType ?? null;
}

/**
 * Explicit member names identify the resolved interface, independent of source qualification or a using alias.
 * The supplied name may already have a source prefix; only its final member component is preserved.
 */
export function metadataMemberName(member, name = member.metadataName) {
  const implemented = explicitInterfaceOf(member);
  if (!implemented) return name;
  const simpleName = name.slice(name.lastIndexOf('.') + 1);
  return interfaceTypeName(implemented) + '.' + simpleName;
}

/** The Property row name, with an indexer's accessor name and the resolved explicit interface prefix. */
export function metadataPropertyName(property, accessor) {
  let name = property.metadataName;
  if (property.parameters.length && accessor) {
    const accessorName = accessor.name.slice(accessor.name.lastIndexOf('.') + 1);
    name = accessorName.slice(4);
  }
  return metadataMemberName(property, name);
}
