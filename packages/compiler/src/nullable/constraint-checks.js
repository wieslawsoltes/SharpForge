/**
 * Nullability of type arguments against the constraints of their type parameters (SF-A02-T05.6):
 *
 *   CS8714  a possibly null type argument for a `notnull` type parameter           `I<string?>`, `I<int?>`
 *   CS8634  a possibly null type argument for a `class` type parameter             `G<string?>`
 *   CS8631  a possibly null type argument for a non-nullable constraint type       `H<Shape?>` where T : Shape
 *
 * A type argument is possibly null when it is an annotated reference type, a nullable value type, or a type parameter
 * that nothing constrains to be not null. `class` and type constraints count only when they were written in a
 * nullable annotation context (otherwise they are oblivious); `notnull` always counts. These are warnings of the
 * nullable warning context of the place the type argument is written; the callers decide that.
 */
import { DiagnosticId } from '../diagnostics/codes.js';
import { NullableAnnotation, TypeKind } from '../symbols/types.js';

const isTypeParameter = type => type?.typeKind === TypeKind.TypeParameter;
const typeOfConstraint = constraint => constraint.type ?? constraint;

/** True when the constraints of a type parameter are written where nullable annotations are enabled. */
function hasAnnotatedConstraints(parameter, isAnnotationContext) {
  const location = parameter.locations?.[0];
  return !!location && isAnnotationContext(location.uri, location.start);
}

/** True when a type parameter may be replaced by a type that includes null. */
function mayBeNull(parameter, isAnnotationContext, seen = new Set()) {
  if (seen.has(parameter)) return false;
  seen.add(parameter);
  if (parameter.hasNotNullConstraint || parameter.hasValueTypeConstraint || parameter.hasUnmanagedTypeConstraint) return false;
  const counts = hasAnnotatedConstraints(parameter, isAnnotationContext);
  if (parameter.hasReferenceTypeConstraint && !parameter.referenceTypeConstraintIsNullable && counts) return false;
  for (const constraint of parameter.constraintTypes) {
    const type = typeOfConstraint(constraint);
    if (isTypeParameter(type)) {
      if (!mayBeNull(type, isAnnotationContext, seen)) return false;
    } else if (counts && !parameter.nullableConstraintTypes?.has(type)) return false;
  }
  return true;
}

/**
 * A type argument as the checks see it.
 * @param argument `{type, nullableAnnotation}`  @returns {{isPossiblyNull: boolean, display: string}}
 */
function describe(argument, isAnnotationContext) {
  const type = argument.type ?? argument,
    isAnnotated = argument.nullableAnnotation === NullableAnnotation.Annotated,
    isNullableValue = type.isNullableValueType === true && !type.isDefinition;
  if (isTypeParameter(type)) return { isPossiblyNull: isAnnotated || mayBeNull(type, isAnnotationContext), display: type.toDisplayString() };
  const display = type.toDisplayString() + (isAnnotated && !isNullableValue ? '?' : '');
  return { isPossiblyNull: isNullableValue || (isAnnotated && type.isReferenceType === true), display, isNullableValue };
}

/**
 * @param {object[]} parameters the type parameters of the generic definition
 * @param {object[]} typeArguments `{type, nullableAnnotation}` per parameter
 * @param {{display: string, isAnnotationContext: (uri: string, position: number) => boolean}} context `display` is the
 *   generic type or method as the message prints it
 * @returns {{code: string, args: string[], index: number}[]}
 */
export function nullabilityViolations(parameters, typeArguments, { display, isAnnotationContext }) {
  const results = [];
  parameters.forEach((parameter, index) => {
    const argument = typeArguments[index];
    if (!argument || (argument.type ?? argument).isErrorType?.()) return;
    const described = describe(argument, isAnnotationContext);
    if (!described.isPossiblyNull) return;
    if (parameter.hasNotNullConstraint) results.push({ code: DiagnosticId.CS8714, args: [display, parameter.name, described.display], index });
    // A nullable value type fails `class` and type constraints with an error of its own.
    if (described.isNullableValue || !hasAnnotatedConstraints(parameter, isAnnotationContext)) return;
    if (parameter.hasReferenceTypeConstraint && !parameter.referenceTypeConstraintIsNullable) {
      results.push({ code: DiagnosticId.CS8634, args: [display, parameter.name, described.display], index });
    }
    for (const constraint of parameter.constraintTypes) {
      const type = typeOfConstraint(constraint);
      if (isTypeParameter(type) || parameter.nullableConstraintTypes?.has(type)) continue;
      results.push({ code: DiagnosticId.CS8631, args: [display, type.toDisplayString(), parameter.name, described.display], index });
    }
  });
  return results;
}

const memberDeclarations = new Set(['MethodDeclaration', 'PropertyDeclaration', 'EventDeclaration']);
const fieldDeclarations = new Set(['FieldDeclaration', 'EventFieldDeclaration']);
const parameterOwners = new Set(['MethodDeclaration', 'IndexerDeclaration', 'ConstructorDeclaration', 'OperatorDeclaration']);
const typeDeclarations = new Set(['ClassDeclaration', 'StructDeclaration', 'InterfaceDeclaration', 'RecordDeclaration', 'RecordStructDeclaration']);

/**
 * Where Roslyn reports the nullability of a type argument written in a declaration: on the name of the field,
 * property, event, method or parameter whose type contains it, on the type of a base list, on the type parameter of a
 * constraint clause. Null where the warning stays on the type argument itself: locals, expressions, lambdas, local
 * functions and delegate declarations.
 */
export function declarationNameOf(typeSyntax) {
  for (let node = typeSyntax.parent; node; node = node.parent) {
    const kind = node.kind;
    if (kind === 'Parameter') return parameterOwners.has(node.parent?.parent?.kind) ? (node.identifier ?? null) : null;
    if (kind === 'VariableDeclaration') return fieldDeclarations.has(node.parent?.kind) ? (node.variables[0]?.identifier ?? null) : null;
    if (memberDeclarations.has(kind)) return node.identifier ?? null;
    if (kind === 'IndexerDeclaration') return node.thisKeyword ?? null;
    if (kind === 'BaseList') return typeDeclarations.has(node.parent?.kind) ? (node.parent.identifier ?? null) : null;
    if (kind === 'TypeParameterConstraintClause') return constrainedParameterOf(node);
    const isTypeSyntax =
      kind.endsWith('Type') || kind.endsWith('Name') || kind === 'TypeArgumentList' || kind === 'ArrayRankSpecifier' || kind.endsWith('Constraint');
    if (!isTypeSyntax && kind !== 'TupleElement') return null;
  }
  return null;
}

/** The declaration of the type parameter a constraint clause is about, in the type parameter list of its owner. */
function constrainedParameterOf(clause) {
  const name = clause.name?.identifier?.valueText,
    parameters = clause.parent?.typeParameterList?.parameters ?? [];
  for (const parameter of parameters) if (parameter.identifier?.valueText === name) return parameter.identifier;
  return null;
}
