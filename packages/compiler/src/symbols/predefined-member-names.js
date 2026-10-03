/**
 * The names a member access on a predefined type can bind to in the real framework: the public instance members
 * of `object`, the simple types, `string`, arrays and tuples, plus the extension methods `using System;` brings
 * in for strings, arrays and tuples (System.MemoryExtensions, System.TupleExtensions) and
 * `using System.Collections.Generic;` for arrays.
 *
 * The closed registry lists only part of those members, so a failed lookup on such a type normally proves nothing.
 * With this table a name that is *not* listed is known to be missing, which lets the binder go on to source
 * extension methods and report CS1929 / CS1061 the way Roslyn does. Only names are recorded; signatures still come
 * from the registry.
 */
import { TypeKind } from './types.js';

const words = text => text.split(/\s+/).filter(Boolean);

const objectNames = words('Equals GetHashCode GetType ToString MemberwiseClone Finalize');
const simpleTypeNames = words('CompareTo GetTypeCode TryFormat');
const stringNames = words(`
  Chars Length Clone CompareTo Contains CopyTo EndsWith EnumerateRunes GetEnumerator GetPinnableReference GetTypeCode
  IndexOf IndexOfAny Insert IsNormalized LastIndexOf LastIndexOfAny Normalize PadLeft PadRight Remove Replace
  ReplaceLineEndings Split StartsWith Substring ToCharArray ToLower ToLowerInvariant ToUpper ToUpperInvariant Trim
  TrimEnd TrimStart TryCopyTo`);
const arrayNames = words(`
  Length LongLength Rank IsFixedSize IsReadOnly IsSynchronized SyncRoot Clone CopyTo GetEnumerator GetLength
  GetLongLength GetLowerBound GetUpperBound GetValue Initialize SetValue AsReadOnly`);
const tupleNames = words('Item1 Item2 Item3 Item4 Item5 Item6 Item7 Rest CompareTo ToTuple ToValueTuple Deconstruct');
const memoryExtensionNames = words(`
  AsSpan AsMemory BinarySearch CommonPrefixLength CompareTo Contains ContainsAny ContainsAnyExcept ContainsAnyInRange
  ContainsAnyExceptInRange CopyTo Count CountAny EndsWith EnumerateLines EnumerateRunes Equals IndexOf IndexOfAny
  IndexOfAnyExcept IndexOfAnyInRange IndexOfAnyExceptInRange IsWhiteSpace LastIndexOf LastIndexOfAny
  LastIndexOfAnyExcept LastIndexOfAnyInRange LastIndexOfAnyExceptInRange Overlaps Replace Reverse SequenceCompareTo
  SequenceEqual Sort Split SplitAny StartsWith ToLower ToLowerInvariant ToUpper ToUpperInvariant Trim TrimEnd
  TrimStart TryWrite IsNormalized Normalize`);

const simpleTypes = new Set([
  'System_Boolean',
  'System_Char',
  'System_SByte',
  'System_Byte',
  'System_Int16',
  'System_UInt16',
  'System_Int32',
  'System_UInt32',
  'System_Int64',
  'System_UInt64',
  'System_Single',
  'System_Double',
  'System_Decimal',
]);
const forObject = new Set(objectNames);
const forSimpleTypes = new Set([...objectNames, ...simpleTypeNames]);
const forString = new Set([...objectNames, ...stringNames, ...memoryExtensionNames]);
const forArrays = new Set([...objectNames, ...arrayNames, ...memoryExtensionNames]);
const forTuples = new Set([...objectNames, ...tupleNames]);

/** The complete set of member names of a predefined type, or null when the type's members are not known in full. */
function knownNames(type) {
  if (type.typeKind === TypeKind.Array) return forArrays;
  if (type.isTupleType) return forTuples;
  const special = type.specialType;
  if (special === 'System_Object') return forObject;
  if (special === 'System_String') return forString;
  if (simpleTypes.has(special) && !type.isNativeInteger) return forSimpleTypes;
  return null;
}

/** True when `name` is certainly not an instance member (nor a System extension) of the predefined type `type`. */
export function isKnownMissingMember(type, name) {
  const names = knownNames(type);
  if (names === null || names.has(name)) return false;
  return !(type.isTupleType && type.tupleElementNames?.includes(name));
}
