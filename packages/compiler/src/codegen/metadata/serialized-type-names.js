/** Reflection type-name grammar used by ECMA-335 custom-attribute SerStrings. */
import { SymbolKind, TypeKind, ArrayTypeSymbol, PointerTypeSymbol } from '../../symbols/types.js';
import { allTypeArguments } from '../generics.js';
import { MetadataEmitError, namespaceOf, definitionNameOf } from './type-tokens.js';
import { contractAssemblyOf } from './reference-contracts.js';

/** The metadata name of a definition, including enclosing types and file-local mangling. */
export function fullNameOf(type) {
  const definition = type.originalDefinition ?? type;
  if (definition.containingType) return fullNameOf(definition.containingType) + '+' + definitionNameOf(definition);
  const namespace = namespaceOf(definition);
  return (namespace ? namespace + '.' : '') + definitionNameOf(definition);
}

const escaped = name => name.replace(/[\\,+&*\[\]]/g, character => '\\' + character);

function reflectionDefinitionName(type) {
  const definition = type.originalDefinition ?? type;
  if (definition.containingType) return reflectionDefinitionName(definition.containingType) + '+' + escaped(definitionNameOf(definition));
  const namespace = namespaceOf(definition);
  return (namespace ? escaped(namespace) + '.' : '') + escaped(definitionNameOf(definition));
}

/** Local types resolve relative to the attributed assembly; foreign types retain their defining identity. */
function assemblyName(type, tokens) {
  if (!tokens) return null;
  let definition = type.originalDefinition ?? type;
  if (tokens.definitions.has(definition)) return null;
  while (definition.containingType) definition = definition.containingType.originalDefinition ?? definition.containingType;
  const identity = definition.containingAssembly?.identity;
  if (identity?.getDisplayName) return identity.getDisplayName();
  return tokens.assemblyOf(definition, fullNameOf(definition))
    ?? contractAssemblyOf(namespaceOf(definition), definition.metadataName)
    ?? null;
}

/** `typeof` can name open definitions, constructed/nested types, arrays, and unmanaged pointers. */
export function serializedTypeName(type, tokens = null) {
  let element = type, suffix = '';
  while (element instanceof ArrayTypeSymbol || element instanceof PointerTypeSymbol) {
    if (element instanceof PointerTypeSymbol) {
      suffix = '*' + suffix;
      element = element.pointedAtType;
    } else {
      suffix = (element.isSZArray ? '[]' : '[' + (element.rank === 1 ? '*' : ','.repeat(element.rank - 1)) + ']') + suffix;
      element = element.elementType;
    }
  }
  if (element.typeKind === TypeKind.Dynamic) throw new MetadataEmitError('dynamic cannot be serialized as a typeof attribute argument');
  if (element.kind !== SymbolKind.NamedType) {
    throw new MetadataEmitError(`typeof(${type.toDisplayString()}) in an attribute argument cannot be written`);
  }
  let name = reflectionDefinitionName(element);
  if (!element.isDefinition && !element.isUnboundGenericType) {
    const arguments_ = allTypeArguments(element);
    if (arguments_.length) name += '[' + arguments_.map(argument => '[' + serializedTypeName(argument, tokens) + ']').join(',') + ']';
  }
  const assembly = assemblyName(element, tokens);
  return name + suffix + (assembly ? ', ' + assembly : '');
}
