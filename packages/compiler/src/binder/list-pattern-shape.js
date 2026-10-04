/**
 * What a list pattern `[p1, .., pn]` matches against (C# 11): a type that is countable and indexable.
 *
 *   array (one dimension)   length `ldlen`, element `a[i]`, slice a sub-array
 *   string                  `Length`, `this[int]` (get_Chars), slice `Substring(int, int)`
 *   any other type          an accessible instance `Length` or `Count` property of type `int` and an indexer taking
 *                           one `int`; a slice with a pattern needs `Slice(int, int)` (spans) - a type without it
 *                           (List<T>, IReadOnlyList<T>) takes `..` without a pattern only
 *
 * Indexers that take only a `System.Index` or a `System.Range` are not looked for: every countable type of the
 * class library has the `int` form, which is also what Roslyn's lowering calls.
 */
import { ArrayTypeSymbol, SymbolKind } from '../symbols/types.js';
import { lookupMembers } from './inheritance.js';

const isInt = type => type?.specialType === 'System_Int32';
const isInstanceProperty = member => member.kind === SymbolKind.Property && !member.isStatic && !!member.getMethod;

/** The `Length` or `Count` property a list pattern reads, or null. */
function countOf(type, core, within) {
  for (const name of ['Length', 'Count']) {
    const found = lookupMembers(type, name, core, { within }).members.find(member => isInstanceProperty(member) && !member.parameters?.length);
    if (found && isInt(found.type)) return found;
  }
  return null;
}

/** The indexer `this[int]` of a type, or null. Imported types name it `Item`, source types `this[]`. */
function intIndexerOf(type, core, within) {
  const candidates = ['this[]', 'Item'].flatMap(name => lookupMembers(type, name, core, { within }).members);
  return candidates.find(member => isInstanceProperty(member) && member.parameters?.length === 1 && isInt(member.parameters[0].type)) ?? null;
}

/** `Slice(int start, int length)`, or null. */
function sliceMethodOf(type, core, within) {
  const isSlice = member =>
    member.kind === SymbolKind.Method && !member.isStatic && member.parameters.length === 2 && member.parameters.every(parameter => isInt(parameter.type));
  return lookupMembers(type, 'Slice', core, { within }).members.find(isSlice) ?? null;
}

/**
 * How a value of `type` is read by a list pattern.
 * @param type the input type  @param core the core types  @param within the type the pattern stands in (accessibility)
 * @returns {{kind: 'array'|'string'|'members', elementType, sliceType, count?, indexer?, slice?}|null} `sliceType` is
 *   the type a slice pattern matches (null when the type cannot be sliced); null when `type` is not countable and indexable
 */
export function listPatternShapeOf(type, core, within) {
  if (type instanceof ArrayTypeSymbol) return type.rank === 1 ? { kind: 'array', elementType: type.elementType, sliceType: type } : null;
  if (type.specialType === 'System_String') return { kind: 'string', elementType: core.char, sliceType: type };
  const count = countOf(type, core, within),
    indexer = count ? intIndexerOf(type, core, within) : null;
  if (!indexer) return null;
  const slice = sliceMethodOf(type, core, within);
  return { kind: 'members', elementType: indexer.type, sliceType: slice?.returnType ?? null, count, indexer, slice };
}
