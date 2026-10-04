/**
 * Lambdas and anonymous methods in the nullable walker (SF-A02-T05.4): the body is checked against the delegate type
 * the lambda was converted to.
 *
 *   Func<string> f = () => maybe;        CS8603: the delegate returns a non-nullable string
 *   Func<string?, int> g = x => x.Length CS8602: the parameter is nullable
 *
 * A type parameter of the delegate takes the annotation of its type argument (`Func<string?>`), which the member of
 * the constructed type does not always keep. Where the annotation is not known - a delegate type the framework
 * registry shares between `Func<string>` and `Func<string?>`, or an async lambda, whose result is wrapped in a task -
 * the type is oblivious and nothing is reported.
 */
import { MAYBE_NULL } from './flow-state.js';
import { NullableAnnotation, TypeKind } from '../symbols/types.js';
import { delegateInvoke } from '../overload/type-inference.js';

/** `declared` as the constructed delegate sees it: a type parameter of the delegate becomes its type argument. */
function substituted(declared, constructed, delegateType) {
  const type = declared?.type ?? declared,
    definition = delegateType.originalDefinition ?? delegateType;
  if (type?.typeKind !== TypeKind.TypeParameter || type.containingSymbol !== definition) return constructed ?? null;
  return delegateType.typeArguments?.[type.ordinal] ?? constructed ?? null;
}

/**
 * What the body of a lambda is checked against.
 * @returns {null|{returnTypeWithAnnotations: object|null, returnType: object|null, parameterAnnotations: (string|null)[]}}
 */
export function lambdaSignature(lambda) {
  const delegateType = lambda.boundAs?.type ?? lambda.boundAs,
    invoke = delegateType ? delegateInvoke(delegateType) : null,
    declared = invoke ? delegateInvoke(delegateType.originalDefinition ?? delegateType) : null;
  if (!invoke || !declared) return null;
  const returns = lambda.isAsync ? null : substituted(declared.returnTypeWithAnnotations, invoke.returnTypeWithAnnotations, delegateType),
    parameterAnnotations = invoke.parameters.map((parameter, index) => {
      const typeWithAnnotations = substituted(declared.parameters[index]?.typeWithAnnotations, parameter.typeWithAnnotations, delegateType);
      return typeWithAnnotations?.nullableAnnotation ?? null;
    });
  return { returnTypeWithAnnotations: returns, returnType: returns?.type ?? null, parameterAnnotations };
}

/** Class mixin over the nullable walker core. */
export const NullableLambdas = Base =>
  class extends Base {
    expression(node, flow) {
      if (node?.kind !== 'Lambda' || !flow || node.suppressed) return super.expression(node, flow);
      if (node.body) this.lambda(node, flow.clone());
      return 'notNull';
    }

    lambda(node, flow) {
      const signature = lambdaSignature(node),
        saved = this.method,
        savedTargets = this.jumpTargets;
      // The walker checks `return` against `this.method`: inside the lambda that is the delegate's signature.
      this.method = signature?.returnTypeWithAnnotations ? { ...signature, methodKind: 'lambda' } : null;
      this.jumpTargets = [];
      (node.parameters ?? []).forEach((parameter, index) => {
        if (signature?.parameterAnnotations[index] === NullableAnnotation.Annotated) flow.set(parameter, MAYBE_NULL);
      });
      const body = node.body;
      if ('completes' in body) this.statement(body, flow);
      else {
        const state = this.expression(body, flow);
        if (this.method) this.checkReturn(body, state);
      }
      this.method = saved;
      this.jumpTargets = savedTargets;
    }
  };
