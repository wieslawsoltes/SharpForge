import {copySourceTypeIdentity} from '@sharpforge/bytecode';
import {ArrayTypeSymbol, NamedTypeSymbol, typeOf} from '../../symbols/types.js';

function argumentsOf(type) {
  return [...(type.containingType ? argumentsOf(type.containingType) : []), ...type.typeArguments];
}

function identityOf(generator, input, depth = 0) {
  const type = typeOf(input);
  if (depth > 64) generator.unsupported('a generic type identity that exceeds the construction depth limit');
  if (type instanceof ArrayTypeSymbol) return {element: identityOf(generator, type.elementType, depth + 1),
    rank: type.rank, vector: type.isSZArray};
  if (!(type instanceof NamedTypeSymbol)) generator.unsupported('an open or unmanaged generic type identity');
  return {name: type.originalDefinition.metadataFullName, assembly: generator.isSource(type) ? 'source' : 'core',
    arguments: argumentsOf(type).map(argument => identityOf(generator, argument, depth + 1))};
}

/** Keep true CLR definition/argument spelling separate from monomorphized physical image owner names. */
export function sourceConstructionIdentity(generator, type) {
  return copySourceTypeIdentity(identityOf(generator, type));
}
