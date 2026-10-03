/**
 * Declaration rules of C# 2 type and accessor modifiers (SF-A02-T50).
 *
 *   static classes   - no instance constructor (CS0710), destructor (CS0711), operator (CS0715), indexer (CS0720) or
 *                      protected member (CS1057); not abstract or sealed (CS0418, CS0441); `static` only on classes
 *                      (CS0106). Instance fields, methods, properties and events are CS0708 (binder/overrides.js).
 *   static types     - not a parameter type (CS0721), a return or property type (CS0722) or a field type (CS0723).
 *   partial types    - `partial` directly before the type keyword and only on types and methods (CS0267); all parts
 *                      name the type parameters alike (CS0264) and agree on their constraints (CS0265).
 *   accessors        - an accessibility modifier on one accessor only (CS0274), only when there are two (CS0276),
 *                      more restrictive than the property (CS0273), not private on an abstract property (CS0442).
 *
 * Every function is pure: it returns `[{ code, args, uri, node }]` for the caller to report at `node`.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind, TypeKind, Accessibility } from '../symbols/types.js';
import { MethodKind } from '../symbols/members.js';

const words = tokens => (tokens ?? []).map(token => token.text);
const accessWords = new Set(['public', 'private', 'protected', 'internal']);
const partialTypeKinds = new Set(['ClassDeclaration', 'StructDeclaration', 'InterfaceDeclaration', 'RecordDeclaration', 'RecordStructDeclaration']);
/**
 * Accessibility domains as bit sets over who may access a member besides its own type: everyone outside the
 * assembly (8), derived types outside the assembly (4), derived types inside it (2), other types inside it (1).
 */
const domains = {
  [Accessibility.Public]: 15,
  [Accessibility.ProtectedOrInternal]: 7,
  [Accessibility.Internal]: 3,
  [Accessibility.Protected]: 6,
  [Accessibility.ProtectedAndInternal]: 2,
  [Accessibility.Private]: 0,
};

/** True when the domain of `inner` is a strict subset of the domain of `outer` (protected and internal are not comparable). */
export function isMoreRestrictive(inner, outer) {
  const a = domains[inner],
    b = domains[outer];
  if (a === undefined || b === undefined || a === b) return false;
  return (a & b) === a;
}

const isStaticType = type => type?.isStatic === true && type.typeKind === TypeKind.Class;

function declarationRules(type, add) {
  const first = type.declarations[0],
    all = new Set(type.declarations.flatMap(declaration => words(declaration.syntax.modifiers)));
  for (const declaration of type.declarations) {
    const syntax = declaration.syntax,
      modifiers = syntax.modifiers ?? [],
      partial = modifiers.find(token => token.text === 'partial');
    if (partial && !partialTypeKinds.has(syntax.kind)) add(DiagnosticId.CS0267, [], declaration.uri, syntax.identifier);
    else if (partial && modifiers.at(-1) !== partial) add(DiagnosticId.CS0267, [], declaration.uri, partial);
    if (syntax.kind !== 'ClassDeclaration' && modifiers.some(token => token.text === 'static'))
      add(DiagnosticId.CS0106, ['static'], declaration.uri, syntax.identifier);
  }
  const name = type.toDisplayString();
  if (all.has('abstract') && (all.has('sealed') || all.has('static'))) add(DiagnosticId.CS0418, [name], first.uri, first.syntax.identifier);
  else if (all.has('static') && all.has('sealed')) add(DiagnosticId.CS0441, [name], first.uri, first.syntax.identifier);
}

const squeeze = node => node.toString().replace(/\s+/g, '');

/** The parts of a partial type agree on the names and the constraints of the type parameters. */
function partialRules(type, add) {
  if (type.declarations.length < 2 || !type.arity) return;
  const first = type.declarations[0],
    namesOf = declaration => (declaration.syntax.typeParameterList?.parameters ?? []).map(parameter => parameter.identifier.valueText),
    names = namesOf(first);
  if (type.declarations.some(declaration => namesOf(declaration).join(',') !== names.join(','))) {
    add(DiagnosticId.CS0264, [type.toDisplayString()], first.uri, first.syntax.identifier);
    return;
  }
  for (const parameter of names) {
    const clauses = type.declarations
      .map(declaration => (declaration.syntax.constraintClauses ?? []).find(clause => clause.name.identifier.valueText === parameter))
      .filter(Boolean)
      .map(clause => clause.constraints.map(squeeze).sort().join(','));
    if (new Set(clauses).size > 1) add(DiagnosticId.CS0265, [type.toDisplayString(), parameter], first.uri, first.syntax.identifier);
  }
}

/** Members a static class may not declare. Instance members that could be static are CS0708, reported with the modifiers. */
function staticClassMemberRules(type, member, add) {
  const uri = member.uri ?? member.locations?.[0]?.uri,
    at = member.locations?.[0],
    protectedAccess = [Accessibility.Protected, Accessibility.ProtectedOrInternal, Accessibility.ProtectedAndInternal];
  if (member.kind === SymbolKind.Method && !member.isAccessor) {
    if (member.methodKind === MethodKind.Constructor && !member.isStatic) add(DiagnosticId.CS0710, [], uri, at);
    else if (member.methodKind === MethodKind.Destructor) add(DiagnosticId.CS0711, [type.name], uri, at);
    else if (member.methodKind === MethodKind.UserDefinedOperator || member.methodKind === MethodKind.Conversion)
      add(DiagnosticId.CS0715, [member.toDisplayString()], uri, at);
  }
  if (member.kind === SymbolKind.Property && member.isIndexer) add(DiagnosticId.CS0720, [member.toDisplayString()], uri, at);
  const isAccessor = member.kind === SymbolKind.Method && member.isAccessor;
  const isDestructor = member.kind === SymbolKind.Method && member.methodKind === MethodKind.Destructor;
  if (!isAccessor && !isDestructor && member.kind !== SymbolKind.NamedType && protectedAccess.includes(member.declaredAccessibility))
    add(DiagnosticId.CS1057, [member.toDisplayString()], uri, at);
}

/** A static class is not the type of a parameter, a return value, a property or a field. */
function staticTypeUseRules(member, add) {
  const uri = member.uri ?? member.locations?.[0]?.uri,
    at = member.locations?.[0];
  if (member.kind === SymbolKind.Field && isStaticType(member.type)) add(DiagnosticId.CS0723, [member.type.toDisplayString()], uri, at);
  if (member.kind === SymbolKind.Property && isStaticType(member.type))
    add(DiagnosticId.CS0722, [member.type.toDisplayString()], uri, member.typeSyntax ?? at);
  if (member.kind !== SymbolKind.Method || member.isAccessor) return;
  for (const parameter of member.parameters) {
    if (isStaticType(parameter.type)) add(DiagnosticId.CS0721, [parameter.type.toDisplayString()], uri, parameter.syntax?.type ?? parameter.locations?.[0] ?? at);
  }
  if (!isStaticType(member.returnType)) return;
  // Roslyn points at the name of a method and at the return type of an operator.
  const isOperator = member.methodKind === MethodKind.UserDefinedOperator || member.methodKind === MethodKind.Conversion;
  add(DiagnosticId.CS0722, [member.returnType.toDisplayString()], uri, isOperator ? (member.returnTypeSyntax ?? at) : at);
}

function accessorRules(property, add) {
  const syntax = property.syntax,
    accessors = syntax?.accessorList?.accessors ?? [],
    withAccess = accessors.filter(accessor => words(accessor.modifiers).some(word => accessWords.has(word)));
  if (!withAccess.length) return;
  const uri = property.uri ?? property.locations?.[0]?.uri,
    at = property.locations?.[0],
    display = property.toDisplayString();
  if (withAccess.length > 1) {
    add(DiagnosticId.CS0274, [display], uri, at);
    return;
  }
  if (accessors.length < 2 && !property.isOverride) {
    add(DiagnosticId.CS0276, [display], uri, at);
    return;
  }
  const accessor = withAccess[0],
    method = accessor.keyword.text === 'get' ? property.getMethod : property.setMethod;
  if (!method) return;
  const accessorDisplay = `${display}.${accessor.keyword.text}`;
  if (!isMoreRestrictive(method.declaredAccessibility, property.declaredAccessibility)) {
    add(DiagnosticId.CS0273, [accessorDisplay, display], uri, accessor.keyword);
    return;
  }
  if (property.isAbstract && method.declaredAccessibility === Accessibility.Private) add(DiagnosticId.CS0442, [accessorDisplay], uri, accessor.keyword);
}

/** `partial` on a member that cannot be partial (fields; methods and properties have their own rules). */
function partialMemberRules(type, add) {
  for (const declaration of type.declarations) {
    for (const member of declaration.syntax.members ?? []) {
      if (member.kind !== 'FieldDeclaration') continue;
      const partial = (member.modifiers ?? []).find(token => token.text === 'partial');
      if (partial) add(DiagnosticId.CS0267, [], declaration.uri, partial);
    }
  }
}

/**
 * The modifier rules of one source type and its members.
 * @param type a SourceTypeSymbol  @returns {{code: string, args: any[], uri: string, node: object}[]}
 */
export function checkTypeModifiers(type) {
  const results = [],
    add = (code, args, uri, node) => {
      if (node) results.push({ code, args, uri, node });
    };
  declarationRules(type, add);
  partialRules(type, add);
  partialMemberRules(type, add);
  if (type.typeKind === TypeKind.Enum || type.typeKind === TypeKind.Delegate) return results;
  for (const member of type.getMembers()) {
    if (member.isImplicitlyDeclared) continue;
    if (type.isStatic) staticClassMemberRules(type, member, add);
    staticTypeUseRules(member, add);
    if (member.kind === SymbolKind.Property) accessorRules(member, add);
  }
  return results;
}

const signatureOwners = new Set(['MethodDeclaration', 'PropertyDeclaration', 'IndexerDeclaration', 'EventDeclaration']);
const fieldDeclarations = new Set(['FieldDeclaration', 'EventFieldDeclaration']);

/**
 * Where Roslyn reports a static type used as a type argument (CS0718) in the signature of a member: on the name of
 * the field, method, property, event or parameter whose type contains it. Null for a type written anywhere else
 * (a local, an expression, a base list, a constraint, a delegate declaration), where the diagnostic stays on the
 * type argument.
 */
export function signatureNameOf(typeSyntax) {
  for (let node = typeSyntax.parent; node; node = node.parent) {
    const kind = node.kind;
    if (kind === 'DelegateDeclaration') return null;
    if (kind === 'Parameter') return node.parent?.parent?.kind === 'DelegateDeclaration' ? null : (node.identifier ?? null);
    if (kind === 'VariableDeclaration') return fieldDeclarations.has(node.parent?.kind) ? (node.variables[0]?.identifier ?? null) : null;
    if (signatureOwners.has(kind)) return node.identifier ?? null;
    const isTypeSyntax = kind.endsWith('Type') || kind.endsWith('Name') || kind === 'TypeArgumentList' || kind === 'ArrayRankSpecifier';
    if (!isTypeSyntax) return null;
  }
  return null;
}
