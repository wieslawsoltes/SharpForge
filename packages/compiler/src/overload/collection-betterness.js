/**
 * Better collection conversion from expression (C# 12; C# 13 collection-expressions-better-conversion).
 *
 * Collection literals have no exact natural-type match. C# 12 compares collection categories and element types;
 * C# 13 also compares each expression element, or the iteration type of a spread, with ordinary expression
 * betterness. An empty collection cannot prefer one distinct element type to another.
 */
import { spanElementType } from '../conversions/span.js';
import { stripNullable } from '../conversions/nullable.js';

const isArrayOrInterface = target => target.kind === 'array' || target.kind === 'interface';
const isReadOnlySpan = type => !!spanElementType(type, 'ReadOnlySpan');

/** The preference due solely to span/array/interface shape, after element compatibility has been established. */
function spanPreference(first, second, firstTarget, secondTarget) {
  if (firstTarget.kind !== 'span') return false;
  return isArrayOrInterface(secondTarget) ||
    (isReadOnlySpan(first) && secondTarget.kind === 'span' && !isReadOnlySpan(second));
}

/** C# 12 has no element-by-element betterness; it compares the element type conversion instead. */
function legacyPreference(first, second, firstTarget, secondTarget, conversions) {
  if (spanPreference(first, second, firstTarget, secondTarget)) {
    return conversions.classifyImplicit(firstTarget.elementType, secondTarget.elementType).exists;
  }
  return firstTarget.kind !== 'span' && secondTarget.kind !== 'span' && conversions.classifyImplicit(first, second).exists;
}

/** Compares every element once; opposing preferences or the absence of any preference give zero. */
function elementPreference(elements, first, second, resolver) {
  let result = 0;
  for (const element of elements) {
    const argument = element.spread ? { type: element.iterationType } : element.value;
    if (!argument || (element.spread && !argument.type)) continue;
    const firstConversion = resolver.conversions.classifyFromExpression(argument, first);
    const secondConversion = resolver.conversions.classifyFromExpression(argument, second);
    const preference = resolver.betterConversion(argument, first, firstConversion, second, secondConversion);
    if (preference === 0) continue;
    if (result !== 0 && result !== preference) return 0;
    result = preference;
  }
  return result;
}

/** Returns 1 when `first` is better, -1 when `second` is better, or 0 for an ambiguous collection conversion. */
export function betterCollectionConversion(argument, first, second, resolver) {
  first = stripNullable(first);
  second = stripNullable(second);
  const firstTarget = argument.collectionTarget?.(first);
  const secondTarget = argument.collectionTarget?.(second);
  if (!firstTarget || !secondTarget) return 0;
  const conversions = resolver.conversions;
  if (argument.collectionLanguageVersion < 13) {
    const forward = legacyPreference(first, second, firstTarget, secondTarget, conversions);
    const backward = legacyPreference(second, first, secondTarget, firstTarget, conversions);
    return forward === backward ? 0 : forward ? 1 : -1;
  }
  if (firstTarget.kind !== 'span' && secondTarget.kind !== 'span') {
    const forward = conversions.classifyImplicit(first, second).exists;
    const backward = conversions.classifyImplicit(second, first).exists;
    if (forward !== backward) return forward ? 1 : -1;
  }
  if (!conversions.isIdentity(firstTarget.elementType, secondTarget.elementType)) {
    return elementPreference(argument.elements, firstTarget.elementType, secondTarget.elementType, resolver);
  }
  if (spanPreference(first, second, firstTarget, secondTarget)) return 1;
  if (spanPreference(second, first, secondTarget, firstTarget)) return -1;
  return 0;
}
