/**
 * Interpolated string handler types (SF-A02-T75, C# 10 "improved interpolated strings").
 *
 * A class or struct marked `[InterpolatedStringHandler]` is an applicable handler type: an interpolated string
 * expression converts to it implicitly, and the conversion is the handler pattern (binder/interpolated-string-
 * handlers.js) instead of the creation of a string. Only handler types declared in source are recognised: the
 * framework's `DefaultInterpolatedStringHandler` is not in the framework registry.
 */
import { attributesNamed } from '../binder/bound-attributes.js';

export const interpolatedStringHandlerAttribute = 'System.Runtime.CompilerServices.InterpolatedStringHandlerAttribute';

/** True for a source type marked `[InterpolatedStringHandler]`. */
export function isInterpolatedStringHandlerType(type) {
  const definition = type?.originalDefinition ?? type;
  return !!definition?.isSource && attributesNamed(definition, interpolatedStringHandlerAttribute).length > 0;
}
