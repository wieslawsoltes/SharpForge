/**
 * Interpolated string handler types (SF-A02-T75, C# 10 "improved interpolated strings").
 *
 * A class or struct marked `[InterpolatedStringHandler]` is an applicable handler type: an interpolated string
 * expression converts to it implicitly, and the conversion is the handler pattern (binder/interpolated-string-
 * handlers.js) instead of the creation of a string. Handler types declared in source and those of a referenced
 * assembly (`StringBuilder.AppendInterpolatedStringHandler`, `DefaultInterpolatedStringHandler`) are recognised;
 * the closed framework registry has none.
 */
import { attributesNamed } from '../binder/bound-attributes.js';

export const interpolatedStringHandlerAttribute = 'System.Runtime.CompilerServices.InterpolatedStringHandlerAttribute';

/** True for a source or imported type marked `[InterpolatedStringHandler]`. */
export function isInterpolatedStringHandlerType(type) {
  const definition = type?.originalDefinition ?? type;
  if (!definition) return false;
  if (definition.isSource) return attributesNamed(definition, interpolatedStringHandlerAttribute).length > 0;
  return !!definition.attributes?.some(attribute => attribute.attributeClassName === interpolatedStringHandlerAttribute);
}
