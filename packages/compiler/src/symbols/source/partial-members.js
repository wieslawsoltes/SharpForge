/**
 * Partial members (C# 3 partial methods, C# 9 extended partial methods, C# 13 partial properties and indexers;
 * C# 14 partial constructors and events are merged by ./partial-constructors-events.js).
 *
 * A partial member has a defining part (no body) and an implementing part (a body). The type keeps ONE symbol per
 * member - the implementing part, which carries the body - with the optional-parameter defaults of the defining
 * part; the defining part is linked from it (`partialDefinitionPart`) and removed from the member list. A partial
 * method that is never implemented stays as its defining part, marked `isUnimplementedPartial`: calls to it are
 * removed, arguments included.
 *
 *   methods     CS0759 no defining part          CS8795 accessibility modifiers need an implementing part
 *               CS0756 / CS0757 repeated parts   CS8796 / CS8797 non-void or `out` needs accessibility modifiers
 *               CS8817 return types differ       CS0763 static on one part only    CS8799 accessibility differs
 *               CS0751 not in a partial type     CS0750 abstract           CS8798 virtual modifiers need accessibility
 *               CS0758 params on one part only   CS8800 virtual modifiers differ   CS8818 ref returns differ
 *               CS1066 a default value on the implementing part is never used
 *               CS0761, CS0764, CS8142, CS8663, CS8826: differences between the parts (./partial-method-signatures.js)
 *   properties  CS9248 no implementing part      CS9249 no defining part           CS9250 two defining parts
 *               CS9252 accessor not implemented  CS9255 types differ
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind, RefKind } from '../types.js';
import { MethodKind, DeclarationModifiers } from '../members.js';
import { isSamePartialMethod, partialSignatureRows } from './partial-method-signatures.js';
import { mergePartialConstructorsAndEvents } from './partial-constructors-events.js';

const accessWords = new Set(['public', 'private', 'protected', 'internal']);
const virtualWords = ['virtual', 'override', 'sealed', 'new'];
const wordsOf = member => (member.syntax?.modifiers ?? []).map(token => token.text);
/** The virtual modifiers a part declares, in a fixed order, so that two parts can be compared. */
const virtualModifiersOf = member => virtualWords.filter(word => wordsOf(member).includes(word)).join(' ');
const isPartialMethod = member =>
  member.kind === SymbolKind.Method && member.methodKind === MethodKind.Ordinary && !!(member.modifiers & DeclarationModifiers.Partial);
const isPartialProperty = member => member.kind === SymbolKind.Property && (member.syntax?.modifiers ?? []).some(token => token.text === 'partial');
const hasAccessibility = member => (member.syntax?.modifiers ?? []).some(token => accessWords.has(token.text));
const accessorsOf = property => [property.getMethod, property.setMethod].filter(Boolean);
const isDefiningProperty = property => accessorsOf(property).every(accessor => !accessor.hasBody) && !property.syntax?.expressionBody;
const sameType = (a, b) => !a || !b || a.isErrorType?.() || b.isErrorType?.() || a.equals(b);

function groupBy(members, keyOf) {
  const groups = new Map();
  for (const member of members) {
    const key = keyOf(member);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(member);
  }
  return [...groups.values()];
}

/**
 * Callers see the signature of the defining part: the implementing part (the symbol that stays) takes its default
 * values and answers to its parameter names in named arguments (`callerName`). A default value the implementing
 * part declares itself is never used (CS1066).
 * @returns {object[]} the CS1066 rows
 */
function adoptCallerSignature(definition, implementation) {
  const rows = [];
  definition.parameters.forEach((from, index) => {
    const to = implementation.parameters[index];
    if (!to) return;
    if (to.defaultSyntax) rows.push({ member: implementation, code: DiagnosticId.CS1066, args: [to.name], at: to.locations?.[0] });
    to.defaultSyntax = from.defaultSyntax ?? null;
    to.hasExplicitDefaultValue = !!from.defaultSyntax;
    to.isOptional = !!from.defaultSyntax;
    if (from.defaultSyntax) to.scope = from.scope ?? to.scope;
    if (from.name !== to.name) to.callerName = from.name;
  });
  return rows;
}

function methodRules(method, type) {
  const rows = [];
  if (!type.isPartial) rows.push({ member: method, code: DiagnosticId.CS0751, args: [] });
  // An interface member without a body is abstract without saying so: only the modifier itself is the error.
  if (wordsOf(method).includes('abstract')) rows.push({ member: method, code: DiagnosticId.CS0750, args: [] });
  if (hasAccessibility(method)) return rows;
  const display = method.toDisplayString();
  if ([...virtualWords, 'extern'].some(word => wordsOf(method).includes(word))) rows.push({ member: method, code: DiagnosticId.CS8798, args: [display] });
  if (!method.returnsVoid) rows.push({ member: method, code: DiagnosticId.CS8796, args: [display] });
  else if (method.parameters.some(p => p.refKind === RefKind.Out)) rows.push({ member: method, code: DiagnosticId.CS8797, args: [display] });
  return rows;
}

function methodPairRules(definition, implementation) {
  const rows = [],
    row = code => rows.push({ member: implementation, code, args: [] }),
    endsWithParams = method => !!method.parameters.at(-1)?.isParams;
  if (definition.refKind !== implementation.refKind) row(DiagnosticId.CS8818);
  else if (!sameType(definition.returnType, implementation.returnType)) row(DiagnosticId.CS8817);
  if (definition.isStatic !== implementation.isStatic) row(DiagnosticId.CS0763);
  if (definition.declaredAccessibility !== implementation.declaredAccessibility) row(DiagnosticId.CS8799);
  if (virtualModifiersOf(definition) !== virtualModifiersOf(implementation)) row(DiagnosticId.CS8800);
  if (endsWithParams(definition) !== endsWithParams(implementation)) row(DiagnosticId.CS0758);
  return rows;
}

/**
 * The parts of each partial method. Parts with the same signature belong together (`ref`, `out` and `in` are
 * different signatures here); an implementing part left without a defining part then takes the defining part that
 * differs from it only in what a signature does not count (./partial-method-signatures.js).
 */
function partialMethodGroups(methods) {
  const refKinds = method => method.parameters.map(parameter => parameter.refKind ?? RefKind.None).join(','),
    groups = groupBy(methods, method => method.signatureKey + '|' + refKinds(method)),
    isImplementing = part => part.hasBody || part.isExtern,
    lone = (group, implementing) => group.length === 1 && isImplementing(group[0]) === implementing;
  for (const group of groups.filter(candidate => lone(candidate, true))) {
    const definitions = groups.find(candidate => lone(candidate, false) && isSamePartialMethod(candidate[0], group[0]));
    if (definitions) definitions.push(group.pop());
  }
  return groups.filter(group => group.length);
}

/** Merges the parts of one partial method; returns the symbols to remove and the diagnostics. */
function mergeMethod(parts, type) {
  // An extern partial method has its code elsewhere: it is an implementing part.
  const isImplementing = part => part.hasBody || part.isExtern,
    definitions = parts.filter(part => !isImplementing(part)),
    implementations = parts.filter(isImplementing),
    [definition] = definitions,
    [implementation] = implementations,
    rows = parts.flatMap(part => methodRules(part, type)),
    removed = [];
  for (const extra of definitions.slice(1)) {
    rows.push({ member: extra, code: DiagnosticId.CS0756, args: [] }, { member: extra, code: DiagnosticId.CS0111, args: [extra.name, type.toDisplayString()] });
    removed.push(extra);
  }
  for (const extra of implementations.slice(1)) {
    rows.push({ member: extra, code: DiagnosticId.CS0757, args: [] });
    // Next to a defining part a repeated implementation is only that; two implementations alone are also duplicates.
    if (!definition) rows.push({ member: extra, code: DiagnosticId.CS0111, args: [extra.name, type.toDisplayString()] });
    removed.push(extra);
  }
  if (definition && implementation) {
    rows.push(...methodPairRules(definition, implementation), ...adoptCallerSignature(definition, implementation));
    rows.push(...partialSignatureRows(definition, implementation));
    implementation.partialDefinitionPart = definition;
    definition.partialImplementationPart = implementation;
    removed.push(definition);
  } else if (implementation) rows.push({ member: implementation, code: DiagnosticId.CS0759, args: [implementation.toDisplayString()] });
  else if (hasAccessibility(definition)) rows.push({ member: definition, code: DiagnosticId.CS8795, args: [definition.toDisplayString()] });
  else definition.isUnimplementedPartial = true;
  return { removed, rows };
}

function propertyPairRules(definition, implementation) {
  const rows = [];
  if (!sameType(definition.type, implementation.type)) rows.push({ member: implementation, code: DiagnosticId.CS9255, args: [] });
  for (const kind of ['getMethod', 'setMethod'])
    if (definition[kind] && !implementation[kind]) rows.push({ member: implementation, code: DiagnosticId.CS9252, args: [definition[kind].toDisplayString()] });
  return rows;
}

function mergeProperty(parts) {
  const definitions = parts.filter(isDefiningProperty),
    implementations = parts.filter(part => !isDefiningProperty(part)),
    [definition] = definitions,
    [implementation] = implementations,
    rows = [],
    removed = [];
  for (const extra of definitions.slice(1)) rows.push({ member: extra, code: DiagnosticId.CS9250, args: [] });
  if (definition && implementation) {
    rows.push(...propertyPairRules(definition, implementation), ...adoptCallerSignature(definition, implementation));
    implementation.partialDefinitionPart = definition;
    removed.push(definition);
  } else if (implementation) rows.push({ member: implementation, code: DiagnosticId.CS9249, args: [implementation.toDisplayString()] });
  else rows.push({ member: definition, code: DiagnosticId.CS9248, args: [definition.toDisplayString()] });
  return { removed, rows };
}

/**
 * Merges the partial members of a type in place.
 * @param type the source type  @param {object[]} members its member list, mutated: defining parts that have an
 *   implementing part are removed, together with what was synthesized for them (backing field)
 * @returns {{member: object, code: string, args: any[], at?: object}[]} diagnostics, reported at `at` or at the member's name
 */
export function mergePartialMembers(type, members) {
  const rows = [],
    removed = new Set();
  const apply = result => {
    rows.push(...result.rows);
    for (const symbol of result.removed) removed.add(symbol);
  };
  for (const parts of partialMethodGroups(members.filter(isPartialMethod))) apply(mergeMethod(parts, type));
  const propertyKey = property => property.name + '[' + property.parameters.map(p => p.type?.toDisplayString() ?? '?').join(',') + ']';
  for (const parts of groupBy(members.filter(isPartialProperty), propertyKey)) apply(mergeProperty(parts));
  // C# 14: partial constructors and events.
  apply(mergePartialConstructorsAndEvents(type, members));
  if (!removed.size) return rows;
  const kept = members.filter(member => !removed.has(member) && !removed.has(member.associatedSymbol));
  members.length = 0;
  members.push(...kept);
  return rows;
}
