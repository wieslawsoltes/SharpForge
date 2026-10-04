/**
 * Subsumption and exhaustiveness of switch arms (SF-A02-T08.3).
 *
 * Every pattern is turned into the space of values it matches (flow/pattern-spaces.js). An arm whose space is
 * covered by the arms before it can never be chosen: CS8510 in a switch expression, CS8120 in a switch statement.
 * A switch expression whose arms leave part of the input type uncovered is not exhaustive: CS8509 with an example
 * of an uncovered value, CS8524 when only unnamed enum values are left, CS8846 when only `when` clauses stand in
 * the way.
 *
 * The analysis never guesses. A pattern it cannot enumerate - a run-time type test, a list pattern, a constant of a
 * type the algebra does not model - is opaque: it covers nothing, it is not checked for subsumption, and a switch
 * expression that contains one is not checked for exhaustiveness.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind } from '../symbols/types.js';
import { tupleElements } from '../symbols/tuple-elements.js';
import {
  scalarKind,
  universe,
  withoutNull,
  intersect,
  subtract,
  union,
  isEmpty,
  nullAtom,
  objectAtom,
  boolValues,
  integerValues,
  stringValues,
  subtypePartKey,
  subtypeTagType,
  subtypeTagOf,
} from './pattern-spaces.js';
import { typesCoveredBy, isSubsumedByTypes, isPartialTypeTest } from './pattern-type-tests.js';

const isReferenceLike = type => type.isReferenceType === true || type.typeKind === TypeKind.TypeParameter;
const forSubsumption = Object.freeze({ withReferenceNull: true });
const forExhaustiveness = Object.freeze({ withReferenceNull: false });

/** The constant of a bound constant expression as a JS value, or undefined. */
function constantOf(expression) {
  const constant = expression?.constantValue;
  if (!constant || constant.isNull) return undefined;
  return typeof constant.value === 'bigint' ? Number(constant.value) : constant.value;
}

function relationalRange(operator, value) {
  switch (operator) {
    case '<':
      return [[-Infinity, value - 1]];
    case '<=':
      return [[-Infinity, value]];
    case '>':
      return [[value + 1, Infinity]];
    default:
      return [[value, Infinity]];
  }
}

/** Builds pattern spaces for one switch; `usesDeconstruct` and `usesProperties` record which part keys were used. */
export class SpaceBuilder {
  /** @param {((type: object) => object|null)|null} closedHierarchyOf the closed hierarchy of a type at this use site */
  constructor(closedHierarchyOf = null) {
    this.usesDeconstruct = false;
    this.usesProperties = false;
    this.closedHierarchyOf = closedHierarchyOf;
  }
  /**
   * C# 15 preview (provisional, closed-hierarchies.md revision 1, "Exhaustiveness in switches"): a test for one of
   * the subtypes of a closed class matches the values of that subtype. Null when `testedType` is not such a test.
   */
  subtypePart(testedType, type) {
    const hierarchy = testedType && this.closedHierarchyOf?.(type),
      tag = hierarchy ? subtypeTagOf(hierarchy, testedType) : null;
    return tag === null ? null : { type: subtypeTagType(hierarchy), space: [{ values: stringValues([tag]) }] };
  }
  /** The space of values of `type` that `pattern` matches, or null when the pattern is opaque. */
  of(pattern, type) {
    if (!pattern || !type || type.isErrorType?.() || pattern.hasErrors) return null;
    const all = universe(type);
    switch (pattern.kind) {
      case 'DiscardPattern':
      case 'VarPattern':
        return all;
      case 'ConstantPattern':
        return this.constant(pattern, type);
      case 'RelationalPattern': {
        const value = constantOf(pattern.value);
        if (scalarKind(type) !== 'int' || typeof value !== 'number') return null;
        return intersect(all, [{ values: integerValues(relationalRange(pattern.operator, value)) }], forSubsumption);
      }
      case 'NotPattern': {
        const inner = this.of(pattern.pattern, type);
        return inner && subtract(all, inner, forSubsumption);
      }
      case 'AndPattern':
      case 'OrPattern': {
        const left = this.of(pattern.left, type),
          right = this.of(pattern.right, type);
        if (!left || !right) return null;
        return pattern.kind === 'AndPattern' ? intersect(left, right, forSubsumption) : union(left, right);
      }
      case 'TypePattern':
      case 'DeclarationPattern': {
        if (this.isStaticTypeTest(pattern, type)) return withoutNull(all);
        const subtype = this.subtypePart(pattern.testedType, type);
        return subtype ? [objectAtom(new Map([[subtypePartKey, subtype]]))] : null;
      }
      case 'RecursivePattern':
        return this.recursive(pattern, type);
      default:
        return null;
    }
  }
  isStaticTypeTest(pattern, type) {
    return pattern.outcome === 'always' || pattern.outcome === 'identity' || pattern.testedType?.equals?.(type) === true;
  }
  constant(pattern, type) {
    if (pattern.value?.constantValue?.isNull || pattern.value?.literal === 'null') return [nullAtom];
    const value = constantOf(pattern.value),
      kind = scalarKind(type.isNullableValueType ? type.typeArguments[0].type : type);
    if (kind === 'bool' && typeof value === 'boolean') return [{ values: boolValues(value, !value) }];
    if (kind === 'int' && typeof value === 'number') return [{ values: integerValues([[value, value]]) }];
    if (kind === 'string' && typeof value === 'string') return [{ values: stringValues([value]) }];
    return null;
  }
  recursive(pattern, type) {
    const isStatic = !pattern.testedType || this.isStaticTypeTest(pattern, type),
      subtype = isStatic ? null : this.subtypePart(pattern.testedType, type);
    if (!isStatic && !subtype) return null;
    const hasParts = pattern.properties?.length || pattern.hasPositional;
    if (!hasParts) return subtype ? [objectAtom(new Map([[subtypePartKey, subtype]]))] : withoutNull(universe(type));
    // Parts of a scalar (`{ Length: 3 }` on a string) do not combine with its value sets.
    if (scalarKind(type) || type.isNullableValueType) return null;
    const parts = new Map(subtype ? [[subtypePartKey, subtype]] : []),
      add = (key, partType, partPattern) => {
        const space = this.of(partPattern, partType);
        if (!space || parts.has(key)) return false;
        parts.set(key, { type: partType, space });
        return true;
      };
    for (const property of pattern.properties ?? []) {
      this.usesProperties = true;
      if (!property.member || !add('.' + property.member.name, property.member.type, property.pattern)) return null;
    }
    if (pattern.hasPositional) {
      const positional = pattern.positional;
      // An ITuple test over an `object` also fails on the number of elements: it covers nothing that can be named.
      if (!positional || positional.kind === 'ituple') return null;
      const isTuple = positional.kind === 'tuple';
      if (!isTuple) this.usesDeconstruct = true;
      const keyOf = index => (isTuple ? 'Item' + (index + 1) : `Deconstruct/${positional.parts.length}:${index}`);
      for (const [index, part] of positional.parts.entries()) if (!add(keyOf(index), part.type, part.pattern)) return null;
    }
    return [objectAtom(parts)];
  }
}

// ---- examples of uncovered values, in pattern syntax ----
/** The named members of an enum type as `{name, value}`. */
function enumMembers(type) {
  return type
    .getMembers()
    .filter(member => member.kind === SymbolKind.Field && member.isConst)
    .map(member => ({ name: member.name, value: Number(member.constantValue?.value ?? member.constantValue) }));
}
const inRanges = (ranges, value) => ranges.some(([lo, hi]) => lo <= value && value <= hi);
function sampleValues(values, type) {
  if (values.kind === 'bool') return values.hasFalse ? 'false' : 'true';
  if (values.kind === 'string') return values.isComplement ? (values.set.has('') ? '"A"' : '""') : JSON.stringify([...values.set][0]);
  // As Roslyn samples a numeric set: the smallest value that is not negative, else the negative one nearest to zero.
  const sorted = [...values.ranges].sort((a, b) => a[0] - b[0]),
    notNegative = sorted.find(([, hi]) => hi >= 0),
    value = notNegative ? Math.max(notNegative[0], 0) : sorted.at(-1)[1];
  if (type.typeKind !== TypeKind.Enum) return String(value);
  const named = enumMembers(type).find(member => inRanges(values.ranges, member.value));
  return named ? type.name + '.' + named.name : `(${type.toDisplayString()})${value}`;
}
function sampleAtom(atom, type) {
  if (atom.isNull) return 'null';
  if (atom.values) return sampleValues(atom.values, type.isNullableValueType ? type.typeArguments[0].type : type);
  if (!atom.parts.size) return type.isReferenceType ? 'not null' : '_';
  // A value of a closed class is shown as the first subtype it can be (the closed class itself when it is open).
  const subtype = atom.parts.get(subtypePartKey),
    subtypeName = subtype ? [...subtype.space[0].values.set][0] : '';
  if (subtype && atom.parts.size === 1) return subtypeName;
  const entries = [...atom.parts].filter(([key]) => key !== subtypePartKey).map(([key, part]) => [key, sampleSpace(part.space, part.type)]);
  if (type.isTupleType) {
    const byKey = new Map(entries);
    return '(' + tupleElements(type).map((_, index) => byKey.get('Item' + (index + 1)) ?? '_').join(', ') + ')';
  }
  const positional = entries.filter(([key]) => !key.startsWith('.')).map(([, text]) => text),
    properties = entries.filter(([key]) => key.startsWith('.')).map(([key, text]) => `${key.slice(1)}: ${text}`);
  const parts = (positional.length ? `(${positional.join(', ')})` : '') + (properties.length ? `{ ${properties.join(', ')} }` : '');
  return subtypeName ? `${subtypeName} ${parts}` : parts;
}
function sampleSpace(space, type) {
  const whole = universe(type, false);
  return isEmpty(subtract(whole, space, forExhaustiveness)) ? '_' : sampleAtom(space[0], type);
}

/** True when every uncovered value is an enum value without a name. */
function onlyUnnamedEnumValues(space, type) {
  if (type.typeKind !== TypeKind.Enum) return false;
  const members = enumMembers(type);
  return space.every(atom => !!atom.values && !members.some(member => inRanges(atom.values.ranges, member.value)));
}

/**
 * Checks the arms of one switch.
 * @param type the type of the governing expression
 * @param {{pattern: object, when: object|null, node: object, isDefault?: boolean}[]} arms in source order; `node` is
 *   where a subsumed arm is reported
 * @param {{isExpression: boolean, node: object, closedHierarchyOf?: Function, isSubtype?: Function}} site whether it
 *   is a switch expression, where to report it, (C# 15 preview) the closed hierarchy of a type at this use site, and
 *   whether every value of one type is a value of another (for arms behind a run-time type test)
 * @returns {{code: string, args: any[], node: object}[]}
 */
export function checkSwitchArms(type, arms, site) {
  if (!type || type.isErrorType?.()) return [];
  const builder = new SpaceBuilder(site.closedHierarchyOf ?? null),
    diagnostics = [];
  let covered = [],
    coveredIgnoringWhen = [],
    hasOpaque = false,
    hasDefault = false;
  const coveredTypes = [],
    isSubtype = site.isSubtype ?? (() => false),
    nonNull = withoutNull(universe(type)),
    alwaysMatches = arm => !arm.when || arm.when.constantValue?.value === true;
  for (const arm of arms) {
    if (arm.isDefault) {
      hasDefault = true;
      continue;
    }
    const subsumed = { code: site.isExpression ? DiagnosticId.CS8510 : DiagnosticId.CS8120, args: [], node: arm.node },
      space = builder.of(arm.pattern, type),
      isBehindTypeTest = isSubsumedByTypes(arm.pattern, type, coveredTypes, isSubtype);
    if (alwaysMatches(arm)) coveredTypes.push(...typesCoveredBy(arm.pattern, type));
    if (!space) {
      // Whatever an opaque pattern matches, it cannot be chosen once every value is handled.
      if (isBehindTypeTest || isEmpty(subtract(universe(type), covered, forSubsumption))) diagnostics.push(subsumed);
      // Type tests for part of the input type never add up to the whole of it: they do not silence the check below.
      if (!isPartialTypeTest(arm.pattern, type, isSubtype)) hasOpaque = true;
      continue;
    }
    if (isBehindTypeTest || isEmpty(subtract(space, covered, forSubsumption))) diagnostics.push(subsumed);
    coveredIgnoringWhen = union(coveredIgnoringWhen, space);
    // A constant-false `when` never matches, any other may fail: neither arm covers its values.
    if (!alwaysMatches(arm)) continue;
    covered = union(covered, space);
    // Once every non-null value is handled, so is every non-null value of the input type as a type.
    if (!coveredTypes.includes(type) && isEmpty(subtract(nonNull, covered, forSubsumption))) coveredTypes.push(type);
  }
  const mixesPartKinds = builder.usesDeconstruct && builder.usesProperties;
  if (!site.isExpression || hasOpaque || hasDefault || mixesPartKinds) return diagnostics;
  const all = universe(type, false),
    uncovered = subtract(all, covered, forExhaustiveness);
  if (isEmpty(uncovered)) return diagnostics;
  // Every non-null value is left: Roslyn shows that as 'not null' once an arm handles null, and as '_' otherwise.
  const handlesNull = isReferenceLike(type) && isEmpty(subtract([nullAtom], covered, forSubsumption)),
    sample = sampleSpace(uncovered, type),
    example = sample === '_' && handlesNull ? 'not null' : sample;
  let code = DiagnosticId.CS8509;
  if (isEmpty(subtract(all, coveredIgnoringWhen, forExhaustiveness))) code = DiagnosticId.CS8846;
  else if (onlyUnnamedEnumValues(uncovered, type)) code = DiagnosticId.CS8524;
  diagnostics.push({ code, args: [example], node: site.node });
  return diagnostics;
}
