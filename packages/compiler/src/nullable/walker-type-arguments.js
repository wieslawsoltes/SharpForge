/**
 * Nullability of the type arguments of a generic method call (SF-A02-T05.6; the rules are in constraint-checks.js).
 *
 * Written type arguments (`M<string?>(x)`) are taken as written and reported on the generic name. Inferred ones
 * follow the null-state of the arguments, as in Roslyn: `M(maybe)` infers `string?` where `maybe` may be null and
 * `string` after `if (maybe != null)`; the warning is on the method name.
 */
import { MAYBE_NULL, NOT_NULL } from './flow-state.js';
import { NullableAnnotation } from '../symbols/types.js';
import { nullabilityViolations } from './constraint-checks.js';

/** The name the call is made through: `M`, `M<T>`, or the name of `a.M` / `a?.M`. */
function calledName(syntax) {
  const target = syntax?.expression;
  if (!target) return null;
  if (target.kind === 'SimpleMemberAccessExpression' || target.kind === 'MemberBindingExpression') return target.name ?? null;
  return target;
}

/** The written type arguments with the annotation of their syntax (`M<string?>`): the binder keeps the bare types. */
function writtenTypeArguments(name, method) {
  const written = name.typeArgumentList?.arguments ?? [];
  return method.typeArguments.map((typeArgument, index) => {
    const isAnnotated = written[index]?.kind === 'NullableType' && typeArgument.type?.isReferenceType === true;
    return isAnnotated ? { ...typeArgument, type: typeArgument.type, nullableAnnotation: NullableAnnotation.Annotated } : typeArgument;
  });
}

/** Class mixin over the nullable walker. */
export const NullableTypeArgumentChecks = Base =>
  class extends Base {
    callResult(node, method, argumentStates) {
      this.checkTypeArguments(node, method, argumentStates);
      return super.callResult(node, method, argumentStates);
    }

    checkTypeArguments(node, method, argumentStates) {
      const definition = method.constructedFrom ?? method.originalDefinition ?? method,
        parameters = definition.typeParameters ?? [],
        name = calledName(node.syntax);
      if (!parameters.length || definition === method || method.typeArguments?.length !== parameters.length || !name) return;
      const isWritten = name.kind === 'GenericName',
        typeArguments = isWritten ? writtenTypeArguments(name, method) : this.inferredTypeArguments(node, method, definition, argumentStates);
      const violations = nullabilityViolations([...parameters], typeArguments, {
        display: definition.toDisplayString(),
        isAnnotationContext: (uri, position) => this.host.nullableAt(uri, position).annotations,
      });
      for (const violation of violations) this.warn(name, violation.code, violation.args);
    }

    /**
     * The inferred type arguments with the nullability the arguments have here: a type parameter that is the type of
     * a parameter takes the state of what is passed for it; the others keep the annotation inference gave them.
     */
    inferredTypeArguments(node, method, definition, argumentStates) {
      return method.typeArguments.map((typeArgument, index) => {
        const parameter = definition.typeParameters[index];
        let state = null;
        (node.args ?? []).forEach((argument, position) => {
          const ordinal = method.parameters.indexOf(argument.parameter);
          if (ordinal < 0 || definition.parameters[ordinal]?.type !== parameter) return;
          state = state === MAYBE_NULL || argumentStates[position] === MAYBE_NULL ? MAYBE_NULL : NOT_NULL;
        });
        if (state === null || typeArgument.type?.isReferenceType !== true) return typeArgument;
        const nullableAnnotation = state === MAYBE_NULL ? NullableAnnotation.Annotated : NullableAnnotation.NotAnnotated;
        return { ...typeArgument, type: typeArgument.type, nullableAnnotation };
      });
    }
  };
