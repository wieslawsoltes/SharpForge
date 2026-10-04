/**
 * Which members a `foreach` over an enumerator calls (C# spec 13.9.5), found by member lookup so that members an
 * interface inherits count: `IEnumerator<T>` declares `Current`, and `MoveNext` comes from `IEnumerator`.
 *
 * The collection's own `GetEnumerator` is used when it and its result fit the pattern (a public parameterless
 * instance method whose result has a readable `Current` and a parameterless `MoveNext`). Otherwise the collection is
 * enumerated through `IEnumerable<T>` when it implements one, else through `IEnumerable` - the case of a type that
 * implements the interfaces explicitly.
 */
import { SymbolKind, Accessibility } from '../../symbols/types.js';
import { membersInHierarchy, findConstruction, implementsInterface } from '../../symbols/substitution.js';

const isInstanceMethod = member => member.kind === SymbolKind.Method && !member.isStatic && !member.parameters.length && !member.typeParameters?.length;

/** The first parameterless instance method named `name` that member lookup finds on `type`. */
function parameterlessMethod(type, name, core, isCandidate = () => true) {
  return membersInHierarchy(type, name, core).find(member => isInstanceMethod(member) && isCandidate(member)) ?? null;
}

/** `MoveNext` and `Current` of an enumerator type, or null when it does not have both. */
function enumeratorMembers(enumeratorType, core) {
  if (!enumeratorType || enumeratorType.isErrorType?.()) return null;
  const moveNext = parameterlessMethod(enumeratorType, 'MoveNext', core),
    current = membersInHierarchy(enumeratorType, 'Current', core).find(member => member.kind === SymbolKind.Property && !member.isStatic);
  return moveNext && current?.getMethod ? { enumeratorType, moveNext, current } : null;
}

function throughInterface(collectionType, enumerable, core) {
  const getEnumerator = enumerable.getMembers('GetEnumerator').find(isInstanceMethod),
    members = getEnumerator && enumeratorMembers(getEnumerator.returnType, core);
  return members ? { getEnumerator, viaInterface: enumerable, ...members } : null;
}

/**
 * @param collectionType the type of the collection expression
 * @param core the core types
 * @param extensionGetEnumerator the extension `GetEnumerator` the binder chose (C# 9), or null
 * @returns {{getEnumerator, viaInterface, enumeratorType, moveNext, current}|null} `viaInterface` is the interface
 *   the collection is converted to before `GetEnumerator` is called, or null when its own method is called; null
 *   when the type cannot be enumerated
 */
export function enumerationPattern(collectionType, core, extensionGetEnumerator = null) {
  if (extensionGetEnumerator) {
    const members = enumeratorMembers(extensionGetEnumerator.returnType, core);
    return members ? { getEnumerator: extensionGetEnumerator, viaInterface: null, ...members } : null;
  }
  if (!collectionType) return null;
  const isPublic = member => member.declaredAccessibility === Accessibility.Public,
    own = parameterlessMethod(collectionType, 'GetEnumerator', core, isPublic),
    pattern = own && enumeratorMembers(own.returnType, core);
  if (pattern) return { getEnumerator: own, viaInterface: null, ...pattern };
  const generic = findConstruction(collectionType, core.ienumerableT, core);
  if (generic) return throughInterface(collectionType, generic, core);
  return implementsInterface(collectionType, core.ienumerable, core) ? throughInterface(collectionType, core.ienumerable, core) : null;
}
