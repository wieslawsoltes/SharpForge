/**
 * The sets of values patterns match (SF-A02-T08.3), as a small algebra with union, intersection and difference.
 *
 * A space is a list of atoms (their union). An atom is one of
 *   `{isNull: true}`          the null reference (or the null of a nullable value type);
 *   `{values}`                a set of scalars: booleans, integers of one type (as intervals) or strings;
 *   `{parts: Map<key, {type, space}>}`  the non-null values whose parts lie in the given spaces - tuple elements,
 *                             properties, results of Deconstruct; a part that is not listed is unconstrained.
 * `universe(type)` is the space of every value of a type. Types the algebra does not enumerate (floating point,
 * 64-bit integers, char) are a single atom without parts; patterns that split them are reported as opaque by
 * flow/pattern-exhaustiveness.js and never reach this module.
 */
import { TypeKind } from '../symbols/types.js';
import { numericKind } from '../conversions/numeric.js';

const integerRanges = Object.freeze({
  sbyte: [-128, 127],
  byte: [0, 255],
  short: [-32768, 32767],
  ushort: [0, 65535],
  int: [-2147483648, 2147483647],
  uint: [0, 4294967295],
});

/** The scalar category of a type: 'bool', 'int' (any enumerated integer or enum), 'string', or null. */
export function scalarKind(type) {
  if (!type) return null;
  if (type.specialType === 'System_Boolean') return 'bool';
  if (type.specialType === 'System_String') return 'string';
  return integerRangeOf(type) ? 'int' : null;
}
function integerRangeOf(type) {
  const underlying = type.typeKind === TypeKind.Enum ? (type.enumUnderlyingType ?? type.originalDefinition?.enumUnderlyingType) : type;
  return integerRanges[numericKind(underlying)] ?? (type.typeKind === TypeKind.Enum && !underlying ? integerRanges.int : null);
}
/**
 * C# 15 preview (provisional, csharplang/proposals/closed-enums.md revision 1): a closed enum has no values other
 * than its declared members, so those are all the values of the type.
 */
function closedEnumRanges(type) {
  const values = type
    .getMembers()
    .filter(member => member.isEnumMember && member.enumValue !== null && member.enumValue !== undefined)
    .map(member => Number(member.enumValue));
  return [...new Set(values)].sort((a, b) => a - b).map(value => [value, value]);
}
const isNullable = type => type.isNullableValueType === true && !type.isDefinition;
const isReference = type => type.isReferenceType === true || type.typeKind === TypeKind.TypeParameter;

// ---- scalar value sets ----
export const boolValues = (hasTrue, hasFalse) => ({ kind: 'bool', hasTrue, hasFalse });
export const integerValues = ranges => ({ kind: 'int', ranges });
/** Strings: the listed ones, or with `isComplement` every string except the listed ones. */
export const stringValues = (list, isComplement = false) => ({ kind: 'string', set: new Set(list), isComplement });

function intersectRanges(a, b) {
  const result = [];
  for (const [alo, ahi] of a)
    for (const [blo, bhi] of b) {
      const lo = Math.max(alo, blo),
        hi = Math.min(ahi, bhi);
      if (lo <= hi) result.push([lo, hi]);
    }
  return result;
}
function subtractRanges(a, b) {
  let result = a;
  for (const [blo, bhi] of b) {
    const next = [];
    for (const [lo, hi] of result) {
      if (bhi < lo || blo > hi) {
        next.push([lo, hi]);
        continue;
      }
      if (lo < blo) next.push([lo, blo - 1]);
      if (bhi < hi) next.push([bhi + 1, hi]);
    }
    result = next;
  }
  return result;
}
function intersectValues(a, b) {
  if (a.kind !== b.kind) return null;
  if (a.kind === 'bool') return boolValues(a.hasTrue && b.hasTrue, a.hasFalse && b.hasFalse);
  if (a.kind === 'int') return integerValues(intersectRanges(a.ranges, b.ranges));
  if (a.isComplement && b.isComplement) return stringValues([...a.set, ...b.set], true);
  if (a.isComplement) return stringValues([...b.set].filter(text => !a.set.has(text)));
  return stringValues([...a.set].filter(text => b.set.has(text) !== b.isComplement));
}
function subtractValues(a, b) {
  if (a.kind !== b.kind) return a;
  if (a.kind === 'bool') return boolValues(a.hasTrue && !b.hasTrue, a.hasFalse && !b.hasFalse);
  if (a.kind === 'int') return integerValues(subtractRanges(a.ranges, b.ranges));
  // a - b = a ∩ complement(b)
  return intersectValues(a, stringValues([...b.set], !b.isComplement));
}
function valuesEmpty(values) {
  if (values.kind === 'bool') return !values.hasTrue && !values.hasFalse;
  if (values.kind === 'int') return values.ranges.length === 0;
  return !values.isComplement && values.set.size === 0;
}

// ---- spaces ----
export const nullAtom = Object.freeze({ isNull: true });
export const objectAtom = (parts = new Map()) => ({ parts });

/**
 * Every value of `type`. With `withReferenceNull` false the null reference is left out (a switch expression need not
 * handle it outside a nullable context); the null of `Nullable<T>` always counts.
 */
export function universe(type, withReferenceNull = true) {
  // The subtype part of a closed class (flow/closed-hierarchy.js): one value per subtype.
  if (type.subtypeTags) return [{ values: stringValues(type.subtypeTags) }];
  if (isNullable(type)) return [nullAtom, ...universe(type.typeArguments[0].type, withReferenceNull)];
  const kind = scalarKind(type);
  const nulls = isReference(type) && withReferenceNull ? [nullAtom] : [];
  if (kind === 'bool') return [{ values: boolValues(true, true) }];
  if (kind === 'int') return [{ values: integerValues(type.isClosedEnum ? closedEnumRanges(type) : [integerRangeOf(type)]) }];
  if (kind === 'string') return [...nulls, { values: stringValues([], true) }];
  return [...nulls, objectAtom()];
}
/** The space without the null atom at its top level. */
export const withoutNull = space => space.filter(atom => !atom.isNull);

function atomEmpty(atom) {
  if (atom.isNull) return false;
  if (atom.values) return valuesEmpty(atom.values);
  for (const part of atom.parts.values()) if (isEmpty(part.space)) return true;
  return false;
}
export function isEmpty(space) {
  return space.every(atomEmpty);
}
const compact = space => space.filter(atom => !atomEmpty(atom));

function intersectAtoms(a, b, options) {
  if (a.isNull || b.isNull) return a.isNull && b.isNull ? [nullAtom] : [];
  if (a.values || b.values) {
    const values = a.values && b.values ? intersectValues(a.values, b.values) : null;
    return values ? [{ values }] : [];
  }
  const parts = new Map(a.parts);
  for (const [key, part] of b.parts) {
    const own = parts.get(key);
    parts.set(key, own ? { type: part.type, space: intersect(own.space, part.space, options) } : part);
  }
  return [objectAtom(parts)];
}
export function intersect(a, b, options) {
  return compact(a.flatMap(x => b.flatMap(y => intersectAtoms(x, y, options))));
}
function subtractAtom(a, b, options) {
  if (a.isNull) return b.isNull ? [] : [a];
  if (b.isNull) return [a];
  if (a.values) return b.values ? [{ values: subtractValues(a.values, b.values) }] : [a];
  if (!b.parts) return [a];
  // (a1..an) - (b1..bn): for each part k, the values where the parts before k are in b and part k is not.
  const pieces = [],
    narrowed = new Map(a.parts);
  for (const [key, part] of b.parts) {
    const own = a.parts.get(key)?.space ?? universe(part.type, options.withReferenceNull);
    pieces.push(objectAtom(new Map(narrowed).set(key, { type: part.type, space: subtract(own, part.space, options) })));
    narrowed.set(key, { type: part.type, space: intersect(own, part.space, options) });
  }
  return pieces;
}
export function subtract(a, b, options) {
  let result = a;
  for (const atom of b) result = compact(result.flatMap(x => subtractAtom(x, atom, options)));
  return result;
}
export const union = (a, b) => [...a, ...b];

// ---- closed classes (C# 15 preview, provisional: csharplang/proposals/csharp-15.0/closed-hierarchies.md revision 1) ----
/** The key of the part that says which subtype a value of a closed class is. */
export const subtypePartKey = '$subtype';
/**
 * The pseudo type of the subtype part: its values are the display names of the subtypes, plus the closed class
 * itself when the hierarchy is open (a value no subtype pattern handles).
 */
export function subtypeTagType(hierarchy) {
  const tags = hierarchy.subtypes.map(subtype => subtype.toDisplayString());
  if (hierarchy.isOpen) tags.push(hierarchy.closedType.toDisplayString());
  return { subtypeTags: tags };
}
/** The tag of `testedType` when it is one of the subtypes of the hierarchy, else null. */
export function subtypeTagOf(hierarchy, testedType) {
  const subtype = hierarchy.subtypes.find(candidate => candidate.equals(testedType));
  return subtype ? subtype.toDisplayString() : null;
}
