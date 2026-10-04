/**
 * Type parameters of generic declarations (SF-A02-T02.1).
 *
 * `declareTypeParameters` creates the TypeParameterSymbols of a class, struct, interface, delegate, method or local
 * function from its TypeParameterList (name, variance, location); `bindConstraintClauses` fills in the constraints
 * from the `where` clauses once types can be bound. Generic declarations are looked up by name *and* arity
 * (`findByArity`): `Box`, `Box<T>` and `Box<T,U>` are three different types.
 *
 * Constraint clause diagnostics: CS0699 (no such type parameter), CS0409 (duplicate clause), CS0449 (class/struct/
 * unmanaged/notnull/default combined or not first), CS0401 (new() not last), CS0451 (new() with struct),
 * CS0405 (duplicate constraint), CS0406 (class type not first), CS0701 (sealed type or non-class as constraint),
 * CS0702 (special class), CS0454 (circular constraint dependency), CS0080 (clause on a non-generic declaration).
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { isDynamicType, containsDynamic } from '../dynamic-types.js';
import { TypeParameterSymbol, TypeWithAnnotations, Variance, TypeKind } from '../types.js';

const span = node => {
  const s = node.span;
  return { start: s.start, end: s.end };
};
/** Creates symbols for a TypeParameterList (or returns [] when there is none). Duplicate names report CS0692. */
export function declareTypeParameters(list, owner, uri, report = () => {}) {
  if (!list) return [];
  const seen = new Set(),
    result = [];
  list.parameters.forEach((p, ordinal) => {
    const name = p.identifier.valueText,
      variance = p.varianceKeyword ? (p.varianceKeyword.text === 'out' ? Variance.Out : Variance.In) : Variance.None;
    if (seen.has(name)) report(p.identifier, DiagnosticId.CS0692, [name]);
    seen.add(name);
    const symbol = new TypeParameterSymbol({
      name,
      ordinal,
      containingSymbol: owner,
      variance,
      locations: [{ uri, ...span(p.identifier) }],
    });
    symbol.syntax = p;
    result.push(symbol);
  });
  return result;
}
const forbiddenClasses = new Set(['System_Object', 'System_ValueType', 'System_Array']);
/**
 * Binds `where` clauses onto already declared type parameters.
 * @param {TypeParameterSymbol[]} parameters  @param clauses TypeParameterConstraintClause nodes
 * @param {(typeSyntax)=>TypeSymbol|TypeWithAnnotations} bindType  @param report (node,code,args)
 * @param {{ownerDisplay?:string, useFeature?:(node,featureId:string)=>void}} [options] `useFeature` gates a constraint by language version
 */
const constraintFeatures = Object.freeze({
  System_Enum: 'EnumGenericTypeConstraint',
  System_Delegate: 'DelegateGenericTypeConstraint',
  System_MulticastDelegate: 'DelegateGenericTypeConstraint',
});
export function bindConstraintClauses(parameters, clauses, bindType, report, options = {}) {
  const done = new Set();
  for (const clause of clauses ?? []) {
    const name = clause.name.identifier.valueText,
      parameter = parameters.find(p => p.name === name);
    if (!parameter) {
      report(clause.name, parameters.length ? DiagnosticId.CS0699 : DiagnosticId.CS0080, parameters.length ? [options.ownerDisplay ?? '', name] : []);
      continue;
    }
    if (done.has(parameter)) {
      report(clause.name, DiagnosticId.CS0409, [name]);
      continue;
    }
    done.add(parameter);
    const types = [],
      annotatedTypes = new Map(),
      constraints = clause.constraints;
    parameter.primaryConstraintSyntax = constraints[0] ?? clause;
    constraints.forEach((c, index) => {
      const last = index === constraints.length - 1;
      switch (c.kind) {
        case 'ClassConstraint':
          if (index !== 0) report(c, DiagnosticId.CS0449);
          else {
            parameter.hasReferenceTypeConstraint = true;
            parameter.referenceTypeConstraintIsNullable = !!c.questionToken;
          }
          break;
        case 'StructConstraint':
          if (index !== 0) report(c, DiagnosticId.CS0449);
          else parameter.hasValueTypeConstraint = true;
          break;
        case 'DefaultConstraint':
          if (index !== 0) report(c, DiagnosticId.CS0449);
          else parameter.hasDefaultConstraint = true;
          break;
        case 'ConstructorConstraint':
          if (!last && constraints[index + 1]?.kind !== 'AllowsConstraintClause') report(c.newKeyword ?? c, DiagnosticId.CS0401);
          if (parameter.hasUnmanagedTypeConstraint) report(c.newKeyword ?? c, DiagnosticId.CS8375);
          else if (parameter.hasValueTypeConstraint) report(c, DiagnosticId.CS0451);
          else parameter.hasConstructorConstraint = true;
          break;
        case 'AllowsConstraintClause':
          if (!last) report(c, DiagnosticId.CS9242);
          if (c.constraints.some(x => x.kind === 'RefStructConstraint')) parameter.allowsRefLikeType = true;
          break;
        case 'TypeConstraint': {
          const text = c.type.toString();
          if (text === 'unmanaged' && c.type.kind === 'IdentifierName') {
            if (index !== 0) report(c, DiagnosticId.CS0449);
            else {
              parameter.hasUnmanagedTypeConstraint = true;
              parameter.hasValueTypeConstraint = true;
            }
            break;
          }
          if (text === 'notnull' && c.type.kind === 'IdentifierName') {
            if (index !== 0) report(c, DiagnosticId.CS0449);
            else parameter.hasNotNullConstraint = true;
            break;
          }
          const annotated = bindType(c.type),
            type = annotated?.type ?? annotated;
          if (!type || type.isErrorType()) {
            parameter.hasUnknownConstraint = true;
            break;
          }
          if (types.some(t => t.equals(type))) {
            report(c, DiagnosticId.CS0405, [type.toDisplayString(), parameter.name]);
            break;
          }
          if (containsDynamic(type)) {
            report(c.type, ...(isDynamicType(type) ? [DiagnosticId.CS1967] : [DiagnosticId.CS1968, [type.toDisplayString()]]));
            break;
          }
          const isClass = type.typeKind === TypeKind.Class,
            primaryTaken = parameter.hasReferenceTypeConstraint || parameter.hasValueTypeConstraint;
          if (
            type.typeKind === TypeKind.Struct ||
            type.typeKind === TypeKind.Enum ||
            (type.typeKind === TypeKind.Delegate && !type.specialType) ||
            type.typeKind === TypeKind.Array ||
            (isClass && type.isSealed && !type.isStatic)
          ) {
            report(c.type, DiagnosticId.CS0701, [type.toDisplayString()]);
            break;
          }
          if (isClass && type.isStatic) {
            report(c.type, DiagnosticId.CS0717, [type.toDisplayString()]);
            break;
          }
          if (forbiddenClasses.has(type.specialType)) {
            report(c.type, DiagnosticId.CS0702, [type.toDisplayString()]);
            break;
          }
          if (isClass && (types.length || (index !== 0 && !primaryTaken))) {
            report(c.type, DiagnosticId.CS0406, [type.toDisplayString()]);
            break;
          }
          if (isClass && primaryTaken && !['System_Enum', 'System_Delegate', 'System_MulticastDelegate'].includes(type.specialType)) {
            report(c.type, DiagnosticId.CS0450, [type.toDisplayString()]);
            break;
          }
          // `Enum`, `Delegate` and `MulticastDelegate` are constraints from C# 7.3 (the name may come from a using directive).
          if (constraintFeatures[type.specialType]) options.useFeature?.(c.type, constraintFeatures[type.specialType]);
          types.push(type);
          annotatedTypes.set(type, TypeWithAnnotations.create(annotated));
          // `where T : Shape?`: a nullable constraint type accepts nullable type arguments (nullable/constraint-checks.js).
          if (c.type.kind === 'NullableType' || annotated.isAnnotated) (parameter.nullableConstraintTypes ??= new Set()).add(type);
          break;
        }
      }
    });
    parameter._constraintTypes = types;
    parameter.constraintTypesWithAnnotations = annotatedTypes;
  }
  // A type parameter that must be a value type cannot be the constraint of another one: nothing derives from it.
  for (const p of parameters) {
    for (const constraint of p.constraintTypes) {
      if (constraint.typeKind !== TypeKind.TypeParameter || !constraint.hasValueTypeConstraint) continue;
      report(p.syntax?.identifier ?? p.syntax, constraint.hasUnmanagedTypeConstraint ? DiagnosticId.CS8379 : DiagnosticId.CS0456, [p.name, constraint.name]);
    }
  }
  // Circular dependencies: T : U, U : T.
  for (const p of parameters) {
    const seen = new Set(),
      walk = t => {
        if (seen.has(t)) return t === p;
        seen.add(t);
        return t.constraintTypes.some(c => c.typeKind === TypeKind.TypeParameter && (c === p || walk(c)));
      };
    if (walk(p)) {
      const other = p.constraintTypes.find(c => c.typeKind === TypeKind.TypeParameter);
      report(p.syntax?.identifier ?? p.syntax, DiagnosticId.CS0454, [other?.name ?? p.name, p.name]);
      p._constraintTypes = p.constraintTypes.filter(c => c.typeKind !== TypeKind.TypeParameter);
    }
  }
}
/** Picks the declaration with the given arity among same-named candidates; `null` when none matches. */
export function findByArity(candidates, arity) {
  return candidates.find(c => c.arity === arity) ?? null;
}
/** Roslyn's arity-qualified metadata name: `Box`1`. */
export const arityQualifiedName = (name, arity) => (arity ? name + '`' + arity : name);
/** Copies constraints from a partial declaration's or an overridden method's parameters by position (overrides inherit constraints). */
export function inheritConstraints(parameters, from, map = t => t) {
  parameters.forEach((p, i) => {
    const s = from[i];
    if (!s) return;
    for (const flag of [
      'hasReferenceTypeConstraint',
      'referenceTypeConstraintIsNullable',
      'hasValueTypeConstraint',
      'hasUnmanagedTypeConstraint',
      'hasNotNullConstraint',
      'hasConstructorConstraint',
      'allowsRefLikeType',
    ])
      p[flag] = s[flag];
    p._constraintTypes = s.constraintTypes.map(map);
    p.constraintTypesWithAnnotations = new Map(s.constraintTypes.map((constraint, index) => {
      const annotated = s.constraintTypesWithAnnotations?.get(constraint) ?? TypeWithAnnotations.create(constraint);
      return [p._constraintTypes[index], annotated.withType(p._constraintTypes[index].type ?? p._constraintTypes[index])];
    }));
    if (s.nullableConstraintTypes) p.nullableConstraintTypes = new Set([...s.nullableConstraintTypes].map(map));
  });
}
