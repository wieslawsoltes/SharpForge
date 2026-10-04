import {sourceTypeDisplay} from './source-type-display.js';
/** CLR Type.ToString spelling excludes assembly identities and uses square brackets for generic arguments. */
export function typeDisplayName(type) {
  if (type.sourceIdentity) return sourceTypeDisplay(type.sourceIdentity);
  if (type.genericDefinition) return type.genericDefinition.name + '[' + type.typeArguments.map(typeDisplayName).join(',') + ']';
  if (type.elementType) return typeDisplayName(type.elementType) + type.name.slice(type.elementType.name.length);
  return type.name;
}
