/**
 * Union exhaustiveness: a finite case tag crossed with the existing scalar/property pattern spaces.
 * Cases may overlap; a type pattern covers every compatible case partition. Construction is O(cases × arms)
 * apart from the existing interval/product-space operations. Null contents are distinct from a null union.
 */
import { DiagnosticId } from '../diagnostics/codes.js';
import { typeTestOutcome } from '../conversions/reference.js';
import { SpaceBuilder } from './pattern-exhaustiveness.js';
import { isPartialTypeTest, isSubsumedByTypes, typesCoveredBy } from './pattern-type-tests.js';
import { universe, withoutNull, nullAtom, objectAtom, stringValues, intersect, subtract, union, isEmpty } from './pattern-spaces.js';

const CASE_KEY = '$unionCase';
const VALUE_KEY = '$unionValue';
const algebra = Object.freeze({ withReferenceNull: true });
const emptyPattern = Object.freeze({ kind: 'NotPattern', pattern: { kind: 'DiscardPattern' } });
const alwaysMatches = arm => !arm.when || arm.when.constantValue?.value === true;

function domainOf(shape, inputType) {
  const tags = shape.caseTypes.map((_, index) => String(index));
  const tagType = { subtypeTags: [...tags, 'null'] };
  const tagged = (index, space) => objectAtom(new Map([
    [CASE_KEY, { type: tagType, space: [{ values: stringValues([String(index)]) }] }],
    [VALUE_KEY, { type: shape.caseTypes[index], space }],
  ]));
  const values = shape.caseTypes.map((type, index) => tagged(index, withoutNull(universe(type, false))));
  const nullValue = objectAtom(new Map([[CASE_KEY, { type: tagType, space: [{ values: stringValues(['null']) }] }]]));
  const nulls = inputType.isNullableValueType || inputType.isReferenceType ? [nullAtom, nullValue] : [nullValue];
  return { shape, tagged, values, nulls, all: [...nulls, ...values] };
}

function specialized(pattern, type, core) {
  if (pattern.hasErrors) return pattern;
  if (pattern.kind === 'TypePattern' || pattern.kind === 'DeclarationPattern' || pattern.kind === 'RecursivePattern' && pattern.testedType) {
    const outcome = typeTestOutcome(type, pattern.testedType, core);
    if (outcome === 'never') return emptyPattern;
    return { ...pattern, outcome, unionAccess: null };
  }
  if (pattern.kind === 'ConstantPattern' || pattern.kind === 'RelationalPattern') {
    if (pattern.value?.literal === 'null' || pattern.value?.constantValue?.isNull) return emptyPattern;
    const tested = pattern.value?.type;
    if (tested && typeTestOutcome(type, tested, core) === 'never') return emptyPattern;
  }
  if (pattern.kind === 'AndPattern' || pattern.kind === 'OrPattern')
    return { ...pattern, left: specialized(pattern.left, type, core), right: specialized(pattern.right, type, core) };
  if (pattern.kind === 'NotPattern') return { ...pattern, pattern: specialized(pattern.pattern, type, core) };
  return { ...pattern, unionAccess: null };
}

function changesValueSource(pattern) {
  if (pattern.unionAccess) return !pattern.unionAccess.isNull;
  return pattern.kind === 'AndPattern' && (changesValueSource(pattern.left) || changesValueSource(pattern.right));
}

function coveredPayloadTypes(pattern, objectType) {
  if (!pattern || pattern.hasErrors) return [];
  if (pattern.unionAccess && !pattern.unionAccess.isNull) return typesCoveredBy(pattern, objectType);
  if (pattern.kind === 'OrPattern') return [...coveredPayloadTypes(pattern.left, objectType), ...coveredPayloadTypes(pattern.right, objectType)];
  return [];
}

function subsumedPayload(pattern, covered, builder) {
  if (!pattern || pattern.hasErrors) return false;
  if (pattern.unionAccess && !pattern.unionAccess.isNull)
    return isSubsumedByTypes(pattern, builder.core.object, covered, builder.isSubtype);
  if (pattern.kind === 'AndPattern') return subsumedPayload(pattern.left, covered, builder);
  if (pattern.kind === 'OrPattern') return subsumedPayload(pattern.left, covered, builder) && subsumedPayload(pattern.right, covered, builder);
  return false;
}

class UnionSpaceBuilder {
  constructor(shape, site) {
    this.core = site.core;
    this.domain = domainOf(shape, site.inputType ?? shape.type);
    this.plain = new SpaceBuilder(site.closedHierarchyOf ?? null);
    this.isSubtype = (derived, base) => typeTestOutcome(derived, base, this.core) === 'always';
  }
  /** Partial run-time type tests cannot exhaust a broader case type and therefore must not suppress its warning. */
  isPartialProjection(pattern) {
    if (!pattern || pattern.hasErrors) return false;
    if (pattern.kind === 'AndPattern') return this.isPartialProjection(pattern.left);
    if (pattern.kind === 'OrPattern')
      return [pattern.left, pattern.right].every(part => this.of(part) !== null || this.isPartialProjection(part));
    if (!pattern.unionAccess || pattern.unionAccess.isNull) return false;
    let partial = false;
    for (const type of this.domain.shape.caseTypes) {
      const projected = specialized(pattern, type, this.core);
      if (this.plain.of(projected, type) !== null) continue;
      if (!isPartialTypeTest(projected, type, this.isSubtype)) return false;
      partial = true;
    }
    return partial;
  }
  projected(pattern) {
    const result = [];
    for (const [index, type] of this.domain.shape.caseTypes.entries()) {
      const space = this.plain.of(specialized(pattern, type, this.core), type);
      if (!space) return null;
      result.push(this.domain.tagged(index, withoutNull(space)));
    }
    return result;
  }
  of(pattern) {
    if (!pattern || pattern.hasErrors) return null;
    if (pattern.unionAccess) return pattern.unionAccess.isNull ? this.domain.nulls : this.projected(pattern);
    if (pattern.kind === 'VarPattern' || pattern.kind === 'DiscardPattern') return this.domain.all;
    if (pattern.kind === 'NotPattern') {
      const inner = this.of(pattern.pattern);
      return inner && subtract(this.domain.all, inner, algebra);
    }
    if (pattern.kind === 'OrPattern' || pattern.kind === 'AndPattern') {
      const left = this.of(pattern.left);
      const right = pattern.kind === 'AndPattern' && changesValueSource(pattern.left)
        ? this.projected(pattern.right) : this.of(pattern.right);
      if (!left || !right) return null;
      return pattern.kind === 'OrPattern' ? union(left, right) : intersect(left, right, algebra);
    }
    if (pattern.kind === 'RecursivePattern' && !pattern.testedType && !pattern.hasPositional && !pattern.properties?.length)
      return this.domain.all.filter(atom => !atom.isNull);
    return null;
  }
}

/** Union switch diagnostics, with null warnings left to nullable flow analysis of the Value property. */
export function checkUnionSwitchArms(shape, arms, site) {
  const builder = new UnionSpaceBuilder(shape, site);
  const diagnostics = [];
  let covered = [];
  let ignoringGuards = [];
  let hasOpaque = false;
  let hasDefault = false;
  const coveredTypes = [];
  const constants = new Set();
  for (const arm of arms) {
    if (arm.isDefault) { hasDefault = true; continue; }
    const constant = !site.isExpression && !arm.when && arm.pattern?.kind === 'ConstantPattern'
      ? arm.pattern.value?.constantValue?.toString() : undefined;
    // Duplicate statement labels already have CS0152 from the switch binder; expression arms use CS8510 here.
    if (constant !== undefined && constants.has(constant)) continue;
    if (constant !== undefined) constants.add(constant);
    const space = builder.of(arm.pattern);
    const subsumed = subsumedPayload(arm.pattern, coveredTypes, builder);
    if (alwaysMatches(arm)) coveredTypes.push(...coveredPayloadTypes(arm.pattern, builder.core.object));
    if (!space) {
      if (subsumed || isEmpty(subtract(builder.domain.all, covered, algebra))) diagnostics.push({
        code: site.isExpression ? DiagnosticId.CS8510 : DiagnosticId.CS8120, node: arm.node, args: [],
      });
      if (!builder.isPartialProjection(arm.pattern)) hasOpaque = true;
      continue;
    }
    if (subsumed || isEmpty(subtract(space, covered, algebra))) diagnostics.push({
      code: site.isExpression ? DiagnosticId.CS8510 : DiagnosticId.CS8120, node: arm.node, args: [],
    });
    ignoringGuards = union(ignoringGuards, space);
    if (alwaysMatches(arm)) covered = union(covered, space);
  }
  if (!site.isExpression || hasDefault || hasOpaque) return diagnostics;
  const missing = subtract(builder.domain.values, covered, algebra);
  if (isEmpty(missing)) return diagnostics;
  const firstTag = missing[0]?.parts.get(CASE_KEY)?.space[0]?.values.set.values().next().value;
  const example = shape.caseTypes[Number(firstTag)]?.toDisplayString() ?? '_';
  const guarded = isEmpty(subtract(builder.domain.values, ignoringGuards, algebra));
  diagnostics.push({ code: guarded ? DiagnosticId.CS8846 : DiagnosticId.CS8509, node: site.node, args: [example] });
  return diagnostics;
}
