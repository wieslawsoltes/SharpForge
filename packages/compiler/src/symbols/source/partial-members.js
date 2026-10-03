/**
 * Partial members (C# 3 partial methods, C# 9 extended partial methods, C# 13 partial properties and indexers).
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
 *               CS0751 not in a partial type     CS0750 abstract
 *   properties  CS9248 no implementing part      CS9249 no defining part           CS9250 two defining parts
 *               CS9252 accessor not implemented  CS9255 types differ
 */
import { SymbolKind, RefKind } from '../types.js';
import { MethodKind, DeclarationModifiers } from '../members.js';

const accessWords = new Set(['public', 'private', 'protected', 'internal']);
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

/** The implementing part takes the defaults the defining part declares for its optional parameters. */
function inheritDefaults(definition, implementation) {
  definition.parameters.forEach((from, index) => {
    const to = implementation.parameters[index];
    if (!to || !from.defaultSyntax || to.defaultSyntax) return;
    to.defaultSyntax = from.defaultSyntax;
    to.hasExplicitDefaultValue = true;
    to.isOptional = true;
    to.scope ??= from.scope;
  });
}

function methodRules(method, type) {
  const rows = [];
  if (!type.isPartial) rows.push({ member: method, code: 'CS0751', args: [] });
  if (method.isAbstract) rows.push({ member: method, code: 'CS0750', args: [] });
  if (hasAccessibility(method)) return rows;
  const display = method.toDisplayString();
  if (!method.returnsVoid) rows.push({ member: method, code: 'CS8796', args: [display] });
  else if (method.parameters.some(p => p.refKind === RefKind.Out)) rows.push({ member: method, code: 'CS8797', args: [display] });
  return rows;
}

function methodPairRules(definition, implementation) {
  const rows = [];
  if (!sameType(definition.returnType, implementation.returnType)) rows.push({ member: implementation, code: 'CS8817', args: [] });
  if (definition.isStatic !== implementation.isStatic) rows.push({ member: implementation, code: 'CS0763', args: [] });
  if (definition.declaredAccessibility !== implementation.declaredAccessibility) rows.push({ member: implementation, code: 'CS8799', args: [] });
  return rows;
}

/** Merges the parts of one partial method; returns the symbols to remove and the diagnostics. */
function mergeMethod(parts, type) {
  const definitions = parts.filter(part => !part.hasBody),
    implementations = parts.filter(part => part.hasBody),
    [definition] = definitions,
    [implementation] = implementations,
    rows = parts.flatMap(part => methodRules(part, type)),
    removed = [];
  for (const extra of definitions.slice(1)) {
    rows.push({ member: extra, code: 'CS0756', args: [] }, { member: extra, code: 'CS0111', args: [extra.name, type.toDisplayString()] });
    removed.push(extra);
  }
  for (const extra of implementations.slice(1)) {
    rows.push({ member: extra, code: 'CS0757', args: [] });
    removed.push(extra);
  }
  if (definition && implementation) {
    rows.push(...methodPairRules(definition, implementation));
    inheritDefaults(definition, implementation);
    implementation.partialDefinitionPart = definition;
    definition.partialImplementationPart = implementation;
    removed.push(definition);
  } else if (implementation) rows.push({ member: implementation, code: 'CS0759', args: [implementation.toDisplayString()] });
  else if (hasAccessibility(definition)) rows.push({ member: definition, code: 'CS8795', args: [definition.toDisplayString()] });
  else definition.isUnimplementedPartial = true;
  return { removed, rows };
}

function propertyPairRules(definition, implementation) {
  const rows = [];
  if (!sameType(definition.type, implementation.type)) rows.push({ member: implementation, code: 'CS9255', args: [] });
  for (const kind of ['getMethod', 'setMethod'])
    if (definition[kind] && !implementation[kind]) rows.push({ member: implementation, code: 'CS9252', args: [definition[kind].toDisplayString()] });
  return rows;
}

function mergeProperty(parts) {
  const definitions = parts.filter(isDefiningProperty),
    implementations = parts.filter(part => !isDefiningProperty(part)),
    [definition] = definitions,
    [implementation] = implementations,
    rows = [],
    removed = [];
  for (const extra of definitions.slice(1)) rows.push({ member: extra, code: 'CS9250', args: [] });
  if (definition && implementation) {
    rows.push(...propertyPairRules(definition, implementation));
    inheritDefaults(definition, implementation);
    implementation.partialDefinitionPart = definition;
    removed.push(definition);
  } else if (implementation) rows.push({ member: implementation, code: 'CS9249', args: [implementation.toDisplayString()] });
  else rows.push({ member: definition, code: 'CS9248', args: [definition.toDisplayString()] });
  return { removed, rows };
}

/**
 * Merges the partial members of a type in place.
 * @param type the source type  @param {object[]} members its member list, mutated: defining parts that have an
 *   implementing part are removed, together with what was synthesized for them (backing field)
 * @returns {{member: object, code: string, args: any[]}[]} diagnostics, reported at each member's name
 */
export function mergePartialMembers(type, members) {
  const rows = [],
    removed = new Set();
  const apply = result => {
    rows.push(...result.rows);
    for (const symbol of result.removed) removed.add(symbol);
  };
  for (const parts of groupBy(members.filter(isPartialMethod), method => method.signatureKey)) apply(mergeMethod(parts, type));
  const propertyKey = property => property.name + '[' + property.parameters.map(p => p.type?.toDisplayString() ?? '?').join(',') + ']';
  for (const parts of groupBy(members.filter(isPartialProperty), propertyKey)) apply(mergeProperty(parts));
  if (!removed.size) return rows;
  const kept = members.filter(member => !removed.has(member) && !removed.has(member.associatedSymbol));
  members.length = 0;
  members.push(...kept);
  return rows;
}
