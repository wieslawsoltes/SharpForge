/**
 * Partial methods (SF-A02-T54): a defining declaration (no body) and an implementing declaration (a body) of the
 * same signature in a partial type are one method.
 *
 * `pairPartialMethods` runs while the members of a type are built: it links the two parts and takes the
 * implementing declaration out of the member list, so lookup sees one method - the definition, whose parameter
 * names and default values callers use - and the body is still bound with the implementation's own parameters.
 * `checkPartialMethods` is the declaration rule (binder/members/declaration-checks.js) that reports what Roslyn
 * reports about the parts. A definition without an implementation has no code: `isUnimplementedPartial` tells the
 * call binder to omit the call (with its arguments) and the delegate conversion to report CS0762.
 *
 * C# 9 extended partial methods (an accessibility modifier, then any return type, `out` parameters and virtual
 * modifiers) must have an implementation (CS8795); without an accessibility modifier the C# 3 restrictions apply
 * (CS8796, CS8797, CS8798).
 */
import { SymbolKind, RefKind } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';

const accessWords = ['public', 'private', 'protected', 'internal'];
const virtualWords = ['virtual', 'override', 'sealed', 'new', 'extern'];

const wordsOf = method => method.modifierWords ?? [];
const hasWord = (method, words) => wordsOf(method).some(word => words.includes(word));
const hasAccessibility = method => hasWord(method, accessWords);

/** True for a declaration of a partial method (either part). */
export function isPartialMethod(member) {
  return member.kind === SymbolKind.Method && member.methodKind === MethodKind.Ordinary && wordsOf(member).includes('partial');
}

/** True for a partial method that has only its defining declaration: it has no code and calls to it are removed. */
export function isUnimplementedPartial(method) {
  const definition = method.originalDefinition ?? method;
  return isPartialMethod(definition) && !definition.hasBody && !definition.partialImplementationPart;
}

/**
 * Links the parts of every partial method in `members` and removes the implementing declarations from the list
 * (in place: the list is the member table of the type being built).
 * @param {object[]} members the declared members of one type, in declaration order
 * @returns {object[]} rows `{ member, code, args }` for a second definition (CS0756) or implementation (CS0757)
 */
export function pairPartialMethods(members) {
  const firstBySignature = new Map(),
    rows = [],
    implementations = [];
  for (const member of members) {
    if (!isPartialMethod(member)) continue;
    const key = member.signatureKey,
      previous = firstBySignature.get(key);
    if (!previous) {
      firstBySignature.set(key, member);
      continue;
    }
    const isPaired = !!(previous.partialImplementationPart ?? previous.partialDefinitionPart);
    if (member.hasBody === previous.hasBody || isPaired) {
      member.isRepeatedPartialPart = true;
      rows.push({ member, code: member.hasBody ? 'CS0757' : 'CS0756', args: [] });
      continue;
    }
    const [definition, implementation] = previous.hasBody ? [member, previous] : [previous, member];
    definition.partialImplementationPart = implementation;
    implementation.partialDefinitionPart = definition;
    implementations.push(implementation);
  }
  for (const implementation of implementations) members.splice(members.indexOf(implementation), 1);
  return rows;
}

/** What one declaration of a partial method must satisfy on its own. */
function declarationRows(type, method) {
  const rows = [],
    row = (code, args = []) => rows.push({ member: method, code, args }),
    display = method.toDisplayString();
  if (!type.isPartial) row('CS0751');
  if (method.hasBody && !method.partialDefinitionPart && !method.isRepeatedPartialPart) row('CS0759', [display]);
  if (hasAccessibility(method)) {
    if (!method.hasBody && !method.partialImplementationPart && !method.isRepeatedPartialPart) row('CS8795', [display]);
    return rows;
  }
  if (!method.returnsVoid) row('CS8796', [display]);
  if (method.parameters.some(parameter => parameter.refKind === RefKind.Out)) row('CS8797', [display]);
  if (hasWord(method, virtualWords)) row('CS8798', [display]);
  return rows;
}

const accessOf = method => accessWords.filter(word => wordsOf(method).includes(word)).join(' ');
const virtualOf = method => ['virtual', 'override', 'sealed', 'new'].filter(word => wordsOf(method).includes(word)).join(' ');

/** What the two parts of one partial method must agree on; reported on the implementing declaration. */
function agreementRows(definition, implementation) {
  const rows = [],
    row = (code, args = []) => rows.push({ member: implementation, code, args });
  if (definition.isStatic !== implementation.isStatic) row('CS0763');
  if (wordsOf(definition).includes('unsafe') !== wordsOf(implementation).includes('unsafe')) row('CS0764');
  const lastOf = method => method.parameters.at(-1);
  if (!!lastOf(definition)?.isParams !== !!lastOf(implementation)?.isParams) row('CS0758');
  if (accessOf(definition) !== accessOf(implementation)) row('CS8799');
  if (virtualOf(definition) !== virtualOf(implementation)) row('CS8800');
  if (definition.refKind !== implementation.refKind) row('CS8818');
  else if (!definition.returnTypeWithAnnotations.type.equals(implementation.returnTypeWithAnnotations.type)) row('CS8817');
  // A default value on the implementing declaration is never used: callers see the definition.
  for (const parameter of implementation.parameters) {
    if (parameter.defaultSyntax && parameter.locations?.[0]) {
      rows.push({ member: implementation, code: 'CS1066', args: [parameter.name], at: parameter.locations[0] });
    }
  }
  return rows;
}

/**
 * The declaration rule for partial methods of one source type.
 * @returns {object[]} rows `{ member, code, args, at? }` (see binder/members/declaration-checks.js)
 */
export function checkPartialMethods(type) {
  const rows = [...(type.partialMethodProblems ?? [])];
  for (const member of type.getMembers()) {
    if (!isPartialMethod(member)) continue;
    rows.push(...declarationRows(type, member));
    const implementation = member.partialImplementationPart;
    if (!implementation) continue;
    rows.push(...declarationRows(type, implementation), ...agreementRows(member, implementation));
  }
  return rows;
}
