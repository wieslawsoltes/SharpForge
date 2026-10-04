/** CLR grouping constraints erase source annotations; exact marker constraints retain their source type uses. */
import { ArrayTypeSymbol, NamedTypeSymbol, NullableAnnotation, TypeWithAnnotations } from '../../symbols/types.js';
import { flatTypeArguments, withArrayElement, withTypeArguments } from '../../symbols/annotated-type-shape.js';
import { MetadataEmitError } from './type-tokens.js';

/** Rebuild only changed array/named shapes, preserving definitions while removing nested nullable and tuple names. */
export function normalizedExtensionConstraint(input) {
  let visited = 0;
  const visit = (value, depth = 0) => {
    if (depth > 128 || ++visited > 100_000) {
      throw new MetadataEmitError('extension constraint exceeds the bounded type-shape limit');
    }
    const annotated = TypeWithAnnotations.create(value);
    let type = annotated.type;
    if (type instanceof ArrayTypeSymbol) {
      type = withArrayElement(type, visit(type.elementTypeWithAnnotations, depth + 1));
    } else if (type instanceof NamedTypeSymbol) {
      type = withTypeArguments(type, flatTypeArguments(type).map(argument => visit(argument, depth + 1)));
      if (type.tupleElementNames) type = type.withTupleElementNames(null);
    }
    return annotated.withType(type).withAnnotation(NullableAnnotation.Oblivious);
  };
  return visit(input);
}
