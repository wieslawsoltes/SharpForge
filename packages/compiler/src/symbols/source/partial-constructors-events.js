/**
 * C# 14 partial constructors and partial events (SF-A02-T87), merged like the other partial members
 * (./partial-members.js): the type keeps the implementing part - the constructor with a body, the event with
 * accessors - and the defining part is linked from it (`partialDefinitionPart`) and removed from the member list.
 *
 *   CS9275  no implementing part        CS9276  no defining part
 *   CS9277  two defining parts          CS9278  two implementing parts
 *   CS9279  a partial event with an initializer
 *   CS9280  a constructor initializer on the defining part of a partial constructor
 *   CS0751  not in a partial type       CS0763 / CS8799  static or accessibility differs between the parts
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind } from '../types.js';
import { MethodKind, DeclarationModifiers } from '../members.js';

const declarationOf = event => {
  // A field-like event is declared by a variable of an EventFieldDeclaration; one with accessors by an EventDeclaration.
  for (let node = event.syntax; node; node = node.parent) if (node.kind === 'EventFieldDeclaration' || node.kind === 'EventDeclaration') return node;
  return event.syntax;
};
const isPartialConstructor = member =>
  member.kind === SymbolKind.Method && member.methodKind === MethodKind.Constructor && !!(member.modifiers & DeclarationModifiers.Partial);
const isPartialEvent = member => member.kind === SymbolKind.Event && (declarationOf(member)?.modifiers ?? []).some(token => token.text === 'partial');
const isDefiningEvent = event => event.isFieldLike;

function groupBy(members, keyOf) {
  const groups = new Map();
  for (const member of members) {
    const key = keyOf(member);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(member);
  }
  return [...groups.values()];
}

/** The rules shared by both member kinds; `isDefining` tells the parts apart. */
function mergeParts(parts, type, isDefining, adopt) {
  const definitions = parts.filter(isDefining),
    implementations = parts.filter(part => !isDefining(part)),
    [definition] = definitions,
    [implementation] = implementations,
    rows = [],
    removed = [],
    row = (member, code, args = [member.toDisplayString()]) => rows.push({ member, code, args });
  if (!type.isPartial) for (const part of parts) row(part, DiagnosticId.CS0751, []);
  for (const extra of definitions.slice(1)) {
    row(extra, DiagnosticId.CS9277);
    // A repeated defining part is also a duplicate member: CS0111 for a constructor, CS0102 for an event.
    if (extra.kind === SymbolKind.Method) row(extra, DiagnosticId.CS0111, [extra.containingType?.name ?? '', type.toDisplayString()]);
    else row(extra, DiagnosticId.CS0102, [type.toDisplayString(), extra.name]);
    removed.push(extra);
  }
  for (const extra of implementations.slice(1)) {
    row(extra, DiagnosticId.CS9278);
    removed.push(extra);
  }
  if (definition && implementation) {
    if (definition.isStatic !== implementation.isStatic) row(implementation, DiagnosticId.CS0763, []);
    if (definition.declaredAccessibility !== implementation.declaredAccessibility) row(implementation, DiagnosticId.CS8799, []);
    adopt?.(definition, implementation, rows);
    implementation.partialDefinitionPart = definition;
    definition.partialImplementationPart = implementation;
    removed.push(definition);
  } else if (implementation) row(implementation, DiagnosticId.CS9276);
  else row(definition, DiagnosticId.CS9275);
  return { removed, rows };
}

/** Callers see the defining part of a constructor: its default values and parameter names. */
function adoptConstructorSignature(definition, implementation, rows) {
  if (definition.initializerSyntax) rows.push({ member: definition, code: DiagnosticId.CS9280, args: [definition.toDisplayString()], at: definition.initializerSyntax });
  definition.parameters.forEach((from, index) => {
    const to = implementation.parameters[index];
    if (!to) return;
    to.defaultSyntax = from.defaultSyntax ?? null;
    to.hasExplicitDefaultValue = !!from.defaultSyntax;
    to.isOptional = !!from.defaultSyntax;
    if (from.defaultSyntax) to.scope = from.scope ?? to.scope;
    if (from.name !== to.name) to.callerName = from.name;
  });
}

/**
 * Merges the partial constructors and events of a type.
 * @returns {{removed: object[], rows: {member: object, code: string, args: any[], at?: object}[]}}
 */
export function mergePartialConstructorsAndEvents(type, members) {
  const rows = [],
    removed = [];
  const apply = result => {
    rows.push(...result.rows);
    removed.push(...result.removed);
  };
  for (const parts of groupBy(members.filter(isPartialConstructor), constructor => constructor.signatureKey))
    apply(mergeParts(parts, type, part => !part.hasBody, adoptConstructorSignature));
  for (const parts of groupBy(members.filter(isPartialEvent), event => event.name)) {
    for (const part of parts) if (part.initializerSyntax) rows.push({ member: part, code: DiagnosticId.CS9279, args: [part.toDisplayString()] });
    apply(mergeParts(parts, type, isDefiningEvent, null));
  }
  return { removed, rows };
}
