/**
 * Required members (C# 11, SF-A02-T10.4).
 *
 *   declaration   CS0106  `required` on anything but an instance field or property
 *                 CS9034  the member must be settable (no readonly field, no get-only property)
 *                 CS9032  neither the member nor its setter may be less visible than the containing type
 *   creation      CS9035  every required member must be assigned in the object initializer, unless the constructor
 *                         used is marked [SetsRequiredMembers]
 *                 CS9036  a required member cannot be "set" by a nested initializer
 *   chaining      CS9039  a constructor that chains to a [SetsRequiredMembers] constructor must carry the attribute
 *
 * A type's required members include those of its base classes.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { SymbolKind, TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { baseTypeChain } from '../../symbols/substitution.js';
import { accessRank } from '../../semantic/analysis-helpers.js';

const attributeNames = new Set(['SetsRequiredMembers', 'SetsRequiredMembersAttribute']);
const isFieldOrProperty = member => member.kind === SymbolKind.Field || member.kind === SymbolKind.Property;
const definitionOf = symbol => symbol.originalDefinition ?? symbol;

/** The required fields and properties of a type and its base classes, most derived first. */
export function requiredMembersOf(type, core) {
  if (!type || (type.typeKind !== TypeKind.Class && type.typeKind !== TypeKind.Struct)) return [];
  const found = [];
  for (const declaring of baseTypeChain(type, core))
    for (const member of declaring.getMembers()) if (isFieldOrProperty(member) && member.isRequired && !member.isStatic) found.push(member);
  return found;
}

/** The simple name of an attribute as written (`A.B.NameAttribute` -> `NameAttribute`). */
function attributeName(attribute) {
  const text = attribute.name?.toString().trim() ?? '';
  return text.slice(text.lastIndexOf('.') + 1);
}

/** True when a constructor is marked [SetsRequiredMembers] (in metadata, or on its declaration). */
export function setsRequiredMembers(constructor) {
  const definition = constructor ? definitionOf(constructor) : null;
  if (!definition) return false;
  if (definition.setsRequiredMembers !== undefined) return !!definition.setsRequiredMembers;
  const lists = definition.syntax?.attributeLists ?? [];
  definition.setsRequiredMembers = lists.some(list => (list.attributes ?? []).some(attribute => attributeNames.has(attributeName(attribute))));
  return definition.setsRequiredMembers;
}

/**
 * The required members an object creation leaves unset.
 * @param {object[]} initializers the bound `{target, value}` entries of the creation
 * @returns {{unset: object[], nested: {member: object, entry: object}[]}} `nested` lists required members that were
 *   given a nested initializer instead of a value
 */
export function requiredMembersLeftUnset(type, constructor, initializers, core) {
  const required = requiredMembersOf(type, core);
  if (!required.length || setsRequiredMembers(constructor)) return { unset: [], nested: [] };
  const assigned = new Map();
  for (const entry of initializers ?? []) {
    const member = entry.target?.field ?? (entry.target?.kind === 'PropertyAccess' ? entry.target.property : null);
    if (member) assigned.set(definitionOf(member), entry);
  }
  const unset = [],
    nested = [];
  for (const member of required) {
    const entry = assigned.get(definitionOf(member));
    if (!entry) unset.push(member);
    else if (entry.value?.kind === 'ObjectInitializer') nested.push({ member, entry });
  }
  return { unset, nested };
}

function declarationProblem(member, type) {
  const settable = member.kind === SymbolKind.Field ? !member.isReadOnly && !member.isConst : !!member.setMethod;
  if (!isFieldOrProperty(member) || member.isStatic || member.isConst || member.parameters?.length) return { code: DiagnosticId.CS0106, args: ['required'] };
  if (!settable) return { code: DiagnosticId.CS9034, args: [member.toDisplayString()] };
  const needed = accessRank(type.declaredAccessibility),
    setter = member.kind === SymbolKind.Property ? accessRank(member.setMethod.declaredAccessibility) : Infinity;
  if (Math.min(accessRank(member.declaredAccessibility), setter) < needed)
    return { code: DiagnosticId.CS9032, args: [member.toDisplayString(), type.toDisplayString()] };
  return null;
}

/** Declaration rules of `required`: rows `{member, code, args}` reported at the member's name. */
export function checkRequiredDeclarations(type) {
  const rows = [];
  for (const member of type.getMembers()) {
    if (!member.isRequired || member.isImplicitlyDeclared) continue;
    if (member.kind === SymbolKind.Method && member.methodKind !== MethodKind.Ordinary) continue;
    const problem = declarationProblem(member, type);
    if (problem) rows.push({ member, ...problem });
  }
  return rows;
}

/** CS9039 for a constructor whose `this(...)` or `base(...)` target sets the required members while it does not say so. */
export function chainingProblem(constructor) {
  const target = constructor.thisTarget ?? constructor.baseTarget ?? null;
  if (!target || !setsRequiredMembers(target) || setsRequiredMembers(constructor)) return null;
  return { code: DiagnosticId.CS9039, args: [], at: constructor.initializerSyntax?.thisOrBaseKeyword ?? null };
}
