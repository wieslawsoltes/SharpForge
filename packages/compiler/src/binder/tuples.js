/**
 * Tuple types (SF-A02-T08.4): the mapping of tuple syntax to System.ValueTuple, the element fields `Item1..ItemN`,
 * element names (explicit and inferred) and the rules for those names.
 *
 * A tuple type is a construction of `System.ValueTuple<T1..Tn>` that carries its element names. The elements are the
 * fields `Item1..ItemN` of the definition; a named element is another name for the field at its position, so a member
 * access through a name binds to the same field symbol as the access through `ItemN`.
 *
 * A tuple of more than seven elements nests (symbols/tuple-elements.js): `(T1..T9)` is `ValueTuple<T1..T7,
 * ValueTuple<T8, T9>>`. Its first seven elements are the fields `Item1..Item7`, the nested tuple is the field `Rest`,
 * and each later element is a field of the tuple type itself that stands for its place in `Rest` (`Item9` is
 * `Rest.Item2`). The names of all elements are kept on the outer type.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { Accessibility } from '../symbols/types.js';
import { FieldSymbol } from '../symbols/members.js';
import { ArrayTypeSymbol } from '../symbols/types.js';
import { tupleElements, tupleRestPosition, isWideTuple } from '../symbols/tuple-elements.js';

export { tupleElements, isWideTuple };

/** The largest tuple that maps to one ValueTuple construction; a longer tuple nests its other elements in `Rest`. */
export const maxTupleElements = tupleRestPosition;

/** Member names of ValueTuple that an element may not take (Roslyn: IsElementNameForbidden). */
const forbiddenNames = new Set(['CompareTo', 'Deconstruct', 'Equals', 'GetHashCode', 'Rest', 'ToString']);
const itemName = /^Item([1-9]\d*)$/;

/** Declares the element fields `Item1..ItemN` (and `Rest` of the eight-argument one) on a `System.ValueTuple` definition (once). */
function ensureElementFields(definition) {
  if (definition.hasTupleFields) return definition;
  definition.hasTupleFields = true;
  definition.typeParameters.forEach((parameter, index) => {
    const name = index === tupleRestPosition ? 'Rest' : 'Item' + (index + 1);
    definition.addMember(new FieldSymbol({ name, type: parameter, containingSymbol: definition, declaredAccessibility: Accessibility.Public }));
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
  const construct = types =>
    types.length <= maxTupleElements
      ? tupleDefinition(bridge, types.length).construct(types)
      : ensureElementFields(bridge.coreType('System_ValueTuple_TRest')).construct([
          ...types.slice(0, maxTupleElements),
          construct(types.slice(maxTupleElements)),
        ]);
  const tuple = construct(elements);
  if (!names.some(Boolean)) return tuple;
  const named = tuple.withTupleElementNames(names);
  if (inferred?.some(Boolean)) named.inferredTupleElementNames = Object.freeze([...inferred]);
  return named;
}

/**
 * The field of a long tuple that stands for an element held in `Rest` (`Item9` of a nine-element tuple). It belongs
 * to the tuple type, has the element's type and is the same symbol for every access to that element of that type.
 */
function restElementField(type, index) {
  const fields = (type.restElementFields ??= new Map());
  let field = fields.get(index);
  if (!field) {
    const init = { name: 'Item' + (index + 1), type: tupleElements(type)[index], containingSymbol: type, declaredAccessibility: Accessibility.Public };
    field = new FieldSymbol({ ...init, isImplicitlyDeclared: true });
    field.tupleElementIndex = index;
    fields.set(index, field);
  }
  return field;
}

/**
 * The element a member name of a tuple type denotes: `{field: 'ItemN', index, isInferred}`, or null when the name is
 * not an element (it may still be a method of ValueTuple, or `Rest`). An element held in `Rest` also has `symbol`,
 * the field of the tuple type that stands for it: no ValueTuple definition declares a field of that name.
 */
export function tupleElement(type, name) {
  if (!type?.isTupleType || type.isDefinition) return null;
  const named = type.tupleElementNames?.indexOf(name) ?? -1,
    item = named < 0 ? itemName.exec(name) : null;
  if (named < 0 && (!item || Number(item[1]) > tupleElements(type).length)) return null;
  ensureElementFields(type.originalDefinition);
  const index = named >= 0 ? named : Number(item[1]) - 1,
    element = { field: 'Item' + (index + 1), index, isInferred: named >= 0 && !!type.inferredTupleElementNames?.[named] };
  return index < maxTupleElements ? element : { ...element, symbol: restElementField(type, index) };
}

/**
 * Why a member name is not usable on a tuple although it looks like an element: `{code, args}` for a name that two
 * elements share (CS0229) or an `ItemN` beyond the last element (CS1061); null for every other name.
 */
export function tupleElementProblem(type, name, display) {
  if (!type?.isTupleType || type.isDefinition) return null;
  if ((type.tupleElementNames ?? []).filter(element => element === name).length > 1) {
    const member = display + '.' + name;
    return { code: DiagnosticId.CS0229, args: [member, member] };
  }
  const item = itemName.exec(name);
  // `Rest` is a field of the eight-argument ValueTuple only.
  if (name === 'Rest' && type.typeArguments.length <= maxTupleElements) return { code: DiagnosticId.CS1061, args: [display, name] };
  const beyond = item && Number(item[1]) > tupleElements(type).length;
  if (beyond && (Number(item[1]) <= maxTupleElements || isWideTuple(type))) return { code: DiagnosticId.CS1061, args: [display, name] };
  return null;
}

/**
 * Reports why a tuple literal does not convert to a tuple type of the same length: one diagnostic per element that
 * does not convert, at that element (Roslyn reports the elements, not the literal). Returns false when the target is
 * not such a tuple type, so the caller reports the literal as a whole.
 * @param binder the body binder (`conversions`, `reportConversionFailure`)
 */
export function reportTupleLiteralFailure(binder, literal, target) {
  if (!target?.isTupleType || target.isDefinition || tupleElements(target).length !== literal.elements.length) return false;
  let reported = false;
  literal.elements.forEach((element, index) => {
    const elementType = tupleElements(target)[index].type,
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
  if (field.tupleElementIndex !== undefined) return field.tupleElementIndex;
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
    if (forbiddenNames.has(name)) problems.push({ index, code: DiagnosticId.CS8126, args: [name] });
    else if (item && Number(item[1]) !== index + 1) problems.push({ index, code: DiagnosticId.CS8125, args: [name, Number(item[1])] });
    else if (seen.has(name)) problems.push({ index, code: DiagnosticId.CS8127, args: [] });
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

/**
 * The element names of every tuple in a type, as `System.Runtime.CompilerServices.TupleElementNamesAttribute` lists
 * them for a symbol of that type: one entry per element of each tuple in pre-order (a nested `Rest` tuple contributes
 * a null per element of its own), null for an unnamed element.
 * @returns {(string|null)[]|null} null when no tuple in the type has a named element (no attribute is emitted)
 */
export function tupleElementNamesOf(type) {
  const names = [];
  const visit = (t, isRest = false) => {
    if (t instanceof ArrayTypeSymbol) return visit(t.elementType);
    if (!t?.typeArguments?.length || t.isDefinition) return undefined;
    const isTuple = !!t.isTupleType,
      wide = isWideTuple(t);
    if (isTuple) {
      const own = isRest ? null : t.tupleElementNames;
      for (let index = 0, count = tupleElements(t).length; index < count; index++) names.push(own?.[index] ?? null);
    }
    if (t.containingType?.typeArguments?.length) visit(t.containingType);
    t.typeArguments.forEach((argument, index) => visit(argument.type, wide && index === tupleRestPosition));
    return undefined;
  };
  visit(type?.type ?? type);
  return names.some(name => name !== null) ? names : null;
}
