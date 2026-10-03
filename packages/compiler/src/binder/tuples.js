/**
 * Tuple types (SF-A02-T08.4): the mapping of tuple syntax to System.ValueTuple, the element fields `Item1..ItemN`,
 * element names (explicit and inferred) and the rules for those names.
 *
 * A tuple type is a construction of `System.ValueTuple<T1..Tn>` that carries its element names. The elements are the
 * fields `Item1..ItemN` of the definition; a named element is another name for the field at its position, so a member
 * access through a name binds to the same field symbol as the access through `ItemN`.
 */
import { Accessibility } from '../symbols/types.js';
import { FieldSymbol } from '../symbols/members.js';

/** The largest tuple that maps to one ValueTuple construction; longer tuples nest in `Rest` and are not bound yet. */
export const maxTupleElements = 7;

/** Member names of ValueTuple that an element may not take (Roslyn: IsElementNameForbidden). */
const forbiddenNames = new Set(['CompareTo', 'Deconstruct', 'Equals', 'GetHashCode', 'Rest', 'ToString']);
const itemName = /^Item([1-9]\d*)$/;

/** Declares the element fields `Item1..ItemN` on a `System.ValueTuple` definition (once). */
function ensureElementFields(definition) {
  if (definition.hasTupleFields) return definition;
  definition.hasTupleFields = true;
  definition.typeParameters.forEach((parameter, index) => {
    definition.addMember(
      new FieldSymbol({ name: 'Item' + (index + 1), type: parameter, containingSymbol: definition, declaredAccessibility: Accessibility.Public }),
    );
  });
  return definition;
}

/** The `System.ValueTuple` definition of an arity, with its element fields declared. */
export function tupleDefinition(bridge, arity) {
  return ensureElementFields(bridge.coreType('System_ValueTuple_T' + arity));
}

/**
 * The tuple type of element types and names.
 * @param bridge the registry bridge  @param {object[]} elements types (or types with annotations)
 * @param {(string|null)[]} names element names  @param {boolean[]} [inferred] positions whose name was inferred
 */
export function tupleTypeOf(bridge, elements, names, inferred = null) {
  const tuple = tupleDefinition(bridge, elements.length).construct(elements);
  if (!names.some(Boolean)) return tuple;
  const named = tuple.withTupleElementNames(names);
  if (inferred?.some(Boolean)) named.inferredTupleElementNames = Object.freeze([...inferred]);
  return named;
}

/**
 * The element a member name of a tuple type denotes: `{field: 'ItemN', index, isInferred}`, or null when the name is
 * not an element (it may still be a method of ValueTuple).
 */
export function tupleElement(type, name) {
  if (!type?.isTupleType || type.isDefinition) return null;
  const named = type.tupleElementNames?.indexOf(name) ?? -1;
  if (named >= 0) return { field: 'Item' + (named + 1), index: named, isInferred: !!type.inferredTupleElementNames?.[named] };
  const item = itemName.exec(name);
  if (!item || Number(item[1]) > type.typeArguments.length) return null;
  ensureElementFields(type.originalDefinition);
  return { field: name, index: Number(item[1]) - 1, isInferred: false };
}

/**
 * Why a member name is not usable on a tuple although it looks like an element: `{code, args}` for a name that two
 * elements share (CS0229) or an `ItemN` beyond the last element (CS1061); null for every other name.
 */
export function tupleElementProblem(type, name, display) {
  if (!type?.isTupleType || type.isDefinition) return null;
  if ((type.tupleElementNames ?? []).filter(element => element === name).length > 1) {
    const member = display + '.' + name;
    return { code: 'CS0229', args: [member, member] };
  }
  const item = itemName.exec(name);
  if (item && Number(item[1]) > type.typeArguments.length && Number(item[1]) <= maxTupleElements) return { code: 'CS1061', args: [display, name] };
  return null;
}

/**
 * Reports why a tuple literal does not convert to a tuple type of the same length: one diagnostic per element that
 * does not convert, at that element (Roslyn reports the elements, not the literal). Returns false when the target is
 * not such a tuple type, so the caller reports the literal as a whole.
 * @param binder the body binder (`conversions`, `reportConversionFailure`)
 */
export function reportTupleLiteralFailure(binder, literal, target) {
  if (!target?.isTupleType || target.isDefinition || target.typeArguments.length !== literal.elements.length) return false;
  let reported = false;
  literal.elements.forEach((element, index) => {
    const elementType = target.typeArguments[index].type,
      conversion = binder.conversions.classifyFromExpression(element, elementType);
    if (conversion.exists && conversion.isImplicit) return;
    binder.reportConversionFailure(element, elementType, element.syntax, conversion);
    reported = true;
  });
  return reported;
}

/** The position of a tuple element field (`Item3` is 2), or -1 for any other symbol. */
export function tupleElementIndex(field) {
  if (!field?.containingType?.isTupleType) return -1;
  const item = itemName.exec(field.name);
  return item ? Number(item[1]) - 1 : -1;
}

/**
 * The problems of explicit element names, as `{index, code, args}` rows: a member name of ValueTuple (CS8126), an
 * `ItemN` at another position (CS8125) and a name used twice (CS8127).
 */
export function tupleNameProblems(names) {
  const problems = [],
    seen = new Set();
  names.forEach((name, index) => {
    if (!name) return;
    const item = itemName.exec(name);
    if (forbiddenNames.has(name)) problems.push({ index, code: 'CS8126', args: [name] });
    else if (item && Number(item[1]) !== index + 1) problems.push({ index, code: 'CS8125', args: [name, Number(item[1])] });
    else if (seen.has(name)) problems.push({ index, code: 'CS8127', args: [] });
    seen.add(name);
  });
  return problems;
}

/** The name an element expression suggests (`a`, `x.a`, `x?.a`), or null. */
function candidateName(syntax) {
  switch (syntax.kind) {
    case 'IdentifierName':
      return syntax.identifier.valueText;
    case 'SimpleMemberAccessExpression':
      return syntax.name.kind === 'IdentifierName' ? syntax.name.identifier.valueText : null;
    case 'ConditionalAccessExpression':
      return syntax.whenNotNull.kind === 'MemberBindingExpression' ? candidateName(syntax.whenNotNull.name) : null;
    default:
      return null;
  }
}

/**
 * Element names of a tuple literal: the explicit ones, plus the names inferred from the element expressions (C# 7.1)
 * where that name is usable - not a ValueTuple member name, not an `ItemN` of another position and not ambiguous.
 * @param {object[]} argumentSyntaxes the tuple's arguments (`{nameColon, expression}`)
 * @returns {{names: (string|null)[], inferred: boolean[]}}
 */
export function tupleLiteralNames(argumentSyntaxes) {
  const explicit = argumentSyntaxes.map(a => a.nameColon?.name.identifier.valueText ?? null),
    candidates = argumentSyntaxes.map((a, i) => (explicit[i] ? null : candidateName(a.expression))),
    counts = new Map();
  for (const name of [...explicit, ...candidates]) if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  const usable = (name, index) => {
    if (!name || counts.get(name) !== 1 || forbiddenNames.has(name)) return false;
    const item = itemName.exec(name);
    return !item || Number(item[1]) === index + 1;
  };
  const inferred = candidates.map(usable);
  return { names: explicit.map((name, i) => name ?? (inferred[i] ? candidates[i] : null)), inferred };
}
