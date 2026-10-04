/**
 * C# 13 params collections (SF-A02-T81): a `params` parameter may have a collection type other than an array.
 *
 *   array        T[]                                                              (C# 1)
 *   span         Span<T>, ReadOnlySpan<T>
 *   interface    IEnumerable<T>, IReadOnlyCollection<T>, IReadOnlyList<T>, ICollection<T>, IList<T>
 *   collection   a type that implements IEnumerable<T>, has an accessible parameterless constructor and an
 *                instance `Add` method (List<T>, HashSet<T>, user types)
 *
 * `paramsCollectionShape` classifies a parameter type; overload resolution uses its element type for the expanded
 * form and `betterParamsCollection` for the tie between two expanded candidates whose element types are the same:
 * ReadOnlySpan<T> over Span<T>, a span over an array or an interface the array converts to, and otherwise the type
 * that converts implicitly to the other (List<T> over IEnumerable<T>, T[] over IList<T>); List<T> against T[] is
 * ambiguous, as in Roslyn.
 *
 * The module also holds the other C# 13 change to overload resolution: `OverloadResolutionPriorityAttribute`
 * (`overloadPriority`, `keepHighestPriority`).
 */
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { ArrayTypeSymbol } from '../symbols/types.js';

const spanNames = new Set(['Span', 'ReadOnlySpan']);
const interfaceNames = new Set(['IEnumerable', 'IReadOnlyCollection', 'IReadOnlyList', 'ICollection', 'IList']);
/** The interfaces a params collection of this kind is created as a List<T> for (the others get an array). */
export const mutableInterfaceNames = new Set(['ICollection', 'IList']);

const definitionOf = type => type.originalDefinition ?? type;
const namespaceOf = type => definitionOf(type).containingSymbol?.toDisplayString?.() ?? '';

/** The element type a collection type enumerates: the `T` of its IEnumerable<T>, else its single type argument. */
function enumeratedElement(type) {
  for (let current = type, depth = 0; current && depth < 32; current = current.baseType, depth++) {
    for (const candidate of current.allInterfaces ?? []) {
      if (definitionOf(candidate).name === 'IEnumerable' && candidate.typeArguments?.length === 1) return candidate.typeArguments[0].type;
    }
    // The registry does not list every interface of a framework collection: its single type argument is its element.
    if (current.typeArguments?.length === 1) return current.typeArguments[0].type;
  }
  return null;
}

/** Instance methods named `name` of a type and its base classes. */
function instanceMethods(type, name) {
  const found = [];
  for (let current = type, depth = 0; current && depth < 32; current = current.baseType, depth++)
    found.push(...current.getMembers(name).filter(member => member.kind === SymbolKind.Method && !member.isStatic));
  return found;
}

/**
 * How a type can be the type of a `params` parameter.
 * @returns {null|{kind:'array'|'span'|'interface'|'collection', element:TypeSymbol}}
 */
export function paramsCollectionShape(type) {
  if (!type || type.isErrorType?.()) return null;
  if (type instanceof ArrayTypeSymbol) return type.rank === 1 ? { kind: 'array', element: type.elementType } : null;
  const definition = definitionOf(type),
    argument = type.typeArguments?.length === 1 ? type.typeArguments[0].type : null;
  if (argument && spanNames.has(definition.name) && namespaceOf(type) === 'System') return { kind: 'span', element: argument };
  if (argument && definition.typeKind === TypeKind.Interface && interfaceNames.has(definition.name)) return { kind: 'interface', element: argument };
  if (type.specialType || (type.typeKind !== TypeKind.Class && type.typeKind !== TypeKind.Struct)) return null;
  const element = enumeratedElement(type);
  if (!element || !instanceMethods(type, 'Add').some(method => method.parameters.length === 1)) return null;
  return { kind: 'collection', element };
}

/** The element type of the expanded form of a `params` parameter, or null when its type is not a params collection. */
export function paramsElementType(type) {
  return paramsCollectionShape(type)?.element ?? null;
}

/**
 * Which of two params collection types with the same element type is the better target.
 * @returns {number} 1 when `first` is better, -1 when `second` is, 0 when neither is
 */
export function betterParamsCollection(first, second, conversions) {
  const a = paramsCollectionShape(first),
    b = paramsCollectionShape(second);
  if (!a || !b || conversions.isIdentity(first, second)) return 0;
  const isReadOnlySpan = type => definitionOf(type).name === 'ReadOnlySpan';
  if (a.kind === 'span' && b.kind === 'span') return isReadOnlySpan(first) === isReadOnlySpan(second) ? 0 : isReadOnlySpan(first) ? 1 : -1;
  if (a.kind === 'span' || b.kind === 'span') {
    const other = a.kind === 'span' ? b : a;
    if (other.kind !== 'array' && other.kind !== 'interface') return 0;
    return a.kind === 'span' ? 1 : -1;
  }
  // Every params collection converts to IEnumerable<T> of its element type, whatever the registry lists for it.
  const converts = (from, fromShape, to) =>
    conversions.classifyImplicit(from, to).exists || (definitionOf(to).name === 'IEnumerable' && fromShape.kind !== 'interface');
  const forward = converts(first, a, second),
    backward = converts(second, b, first);
  return forward === backward ? 0 : forward ? 1 : -1;
}

/** Full name of the attribute that sets the priority of an overload (C# 13). */
export const overloadPriorityAttribute = 'System.Runtime.CompilerServices.OverloadResolutionPriorityAttribute';

const fullNameOf = type => {
  const parts = [];
  for (let symbol = type?.originalDefinition ?? type; symbol && symbol.name; symbol = symbol.containingSymbol) parts.unshift(symbol.name);
  return parts.join('.');
};

/** The declared overload resolution priority of a method, constructor or indexer accessor (0 when it has none). */
export function overloadPriority(member) {
  const definition = member?.originalDefinition ?? member;
  for (const symbol of [definition, definition?.associatedSymbol?.originalDefinition ?? definition?.associatedSymbol]) {
    const attribute = (symbol?.boundAttributes ?? []).find(bound => fullNameOf(bound.attributeClass) === overloadPriorityAttribute),
      value = attribute?.arguments?.[0]?.constantValue?.value;
    if (typeof value === 'number' || typeof value === 'bigint') return Number(value);
    // A member read from metadata carries the decoded attribute instead of a bound one.
    const imported = symbol?.metadataToken ? symbol.attributes?.find(decoded => decoded.attributeClassName === overloadPriorityAttribute) : null,
      importedValue = imported?.constructorArguments?.[0]?.value;
    if (typeof importedValue === 'number' || typeof importedValue === 'bigint') return Number(importedValue);
  }
  return 0;
}

/**
 * C# 13: among the applicable candidates declared by one type, only those with the highest priority stay.
 * @param {object[]} candidates  @param {(candidate)=>MethodSymbol} definitionOf the declaration of a candidate
 */
export function keepHighestPriority(candidates, definitionOf) {
  if (candidates.length < 2) return candidates;
  const highest = new Map(),
    owner = candidate => definitionOf(candidate).containingType?.originalDefinition ?? null,
    priority = candidate => overloadPriority(definitionOf(candidate));
  for (const candidate of candidates) highest.set(owner(candidate), Math.max(highest.get(owner(candidate)) ?? -Infinity, priority(candidate)));
  return candidates.filter(candidate => priority(candidate) === highest.get(owner(candidate)));
}
