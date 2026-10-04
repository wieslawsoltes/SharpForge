/** The C# 12 inline-array conversion is standard, but exists from an expression rather than between two types. */
import { inlineArrayShape } from '../symbols/inline-arrays.js';
import { spanElementType } from './span.js';

/** True for an inline array converted to Span<E> or ReadOnlySpan<E>, with identity element conversion only. */
export function hasInlineArrayConversion(from, to, conversions) {
  const target = spanElementType(to, 'Span') ?? spanElementType(to, 'ReadOnlySpan');
  if (!target) return false;
  const shape = inlineArrayShape(from);
  return !!shape && conversions.isIdentity(shape.elementType, target);
}
