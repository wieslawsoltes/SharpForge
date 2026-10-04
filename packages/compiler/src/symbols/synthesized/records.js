/**
 * The members the compiler synthesizes for a record (SF-A02-T08.6): `Equals(R)`, `Equals(object)`, `GetHashCode()`, `ToString()`,
 * `operator ==` / `!=` and, for a positional record, `Deconstruct`. (The primary constructor, the positional
 * properties and the copy constructor are declared with the type's other members, symbols/source/property-symbols.js.)
 *
 * A member the record declares itself is not synthesized. Each synthesized symbol carries `recordMember`, the kind
 * code generation builds its body from (lowering/records/record-members.js).
 */
import { SymbolKind, TypeKind, Accessibility, RefKind } from '../types.js';
import { MethodSymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from '../members.js';

/** The kinds of synthesized record members. */
export const RecordMember = Object.freeze({
  Equals: 'Equals',
  EqualsObject: 'Equals(object)',
  GetHashCode: 'GetHashCode',
  ToString: 'ToString',
  Equality: 'op_Equality',
  Inequality: 'op_Inequality',
  Deconstruct: 'Deconstruct',
});

const isMethodNamed = (member, name) => member.kind === SymbolKind.Method && member.name === name;

/** The positional properties of a record, in parameter order. */
export function positionalProperties(type) {
  const parameters = type.primaryConstructor?.parameters ?? [];
  return parameters
    .map(parameter => type.getMembers(parameter.name).find(member => member.kind === SymbolKind.Property && member.isPositional))
    .filter(Boolean);
}

/**
 * Adds the synthesized members of a record to `members` (the member list of `type` while it is being built).
 * @param type the record type symbol  @param {object[]} members its declared members  @param core `{bool, int, string, object, void}`
 */
export function synthesizeRecordMembers(type, members, core) {
  const isClass = type.typeKind === TypeKind.Class;
  const declare = (kind, returnType, parameters, modifiers = 0, methodKind = MethodKind.Ordinary) => {
    const method = new MethodSymbol({
      name: kind === RecordMember.EqualsObject ? 'Equals' : kind,
      methodKind,
      returnType,
      parameters,
      containingSymbol: type,
      declaredAccessibility: Accessibility.Public,
      modifiers,
      isImplicitlyDeclared: true,
      locations: type.locations,
    });
    method.recordMember = kind;
    method.hasBody = true;
    members.push(method);
  };
  const parameter = (name, parameterType, refKind = RefKind.None) => new ParameterSymbol({ name, type: parameterType, refKind });
  const declares = (name, matches) => members.some(member => isMethodNamed(member, name) && matches(member.parameters));
  // Inside a generic record its own name is the construction over its type parameters (`Box<T>`), as in declared members.
  const self = type.typeParameters?.length ? type.construct(type.typeParameters) : type;
  const takesSelf = parameters => parameters.length === 1 && (parameters[0].type.originalDefinition ?? parameters[0].type) === type;

  if (!declares('Equals', takesSelf)) declare(RecordMember.Equals, core.bool, [parameter('other', self)]);
  // Overrides of object members: dispatched statically, since nothing derives from the record in a generated image.
  const override = isClass ? DeclarationModifiers.Override : DeclarationModifiers.Override | DeclarationModifiers.ReadOnly;
  const takesObject = parameters => parameters.length === 1 && parameters[0].type === core.object;
  if (!declares('Equals', takesObject)) declare(RecordMember.EqualsObject, core.bool, [parameter('obj', core.object)], override);
  if (!declares('GetHashCode', parameters => !parameters.length)) declare(RecordMember.GetHashCode, core.int, [], override);
  if (!declares('ToString', parameters => !parameters.length)) declare(RecordMember.ToString, core.string, [], override);
  for (const kind of [RecordMember.Equality, RecordMember.Inequality]) {
    const operator = [parameter('left', self), parameter('right', self)];
    declare(kind, core.bool, operator, DeclarationModifiers.Static, MethodKind.UserDefinedOperator);
    members.at(-1).operatorToken = kind === RecordMember.Equality ? '==' : '!=';
  }
  const positional = type.primaryConstructor?.parameters ?? [];
  if (positional.length && !declares('Deconstruct', parameters => parameters.length === positional.length)) {
    const outs = positional.map(p => parameter(p.name, p.typeWithAnnotations ?? p.type, RefKind.Out));
    declare(RecordMember.Deconstruct, core.void, outs);
  }
}

/** The record a record class derives from (as written, possibly constructed), or null. */
export function baseRecordOf(type) {
  const base = type.typeKind === TypeKind.Class ? type.baseType : null;
  return base && (base.originalDefinition ?? base).isRecord ? base : null;
}

/**
 * True for a positional property the record does not really have: a base record already has a property of that
 * name, so the parameter is only passed on to the base constructor (Roslyn synthesizes no property then).
 */
export function isInheritedPositional(type, property) {
  if (!property.isPositional) return false;
  for (let base = baseRecordOf(type); base; base = baseRecordOf(base.originalDefinition ?? base)) {
    const inherited = (base.originalDefinition ?? base).getMembers(property.name);
    if (inherited.some(member => member.kind === SymbolKind.Property || member.kind === SymbolKind.Field)) return true;
  }
  return false;
}
