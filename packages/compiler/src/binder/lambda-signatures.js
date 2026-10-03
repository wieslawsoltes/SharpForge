/**
 * The declared signature of a lambda (SF-A02-T75, SF-A02-T80): what its explicitly typed parameter list says beyond
 * the types - reference kinds, default values (C# 12) and `params` (C# 12) - and the natural type that follows.
 *
 *   natural type    `Action` / `Func` when the signature fits them; otherwise a synthesized delegate type
 *                   (symbols/synthesized/delegates.js), also for a method group
 *   declaration     the parameter list follows the rules of a method's: CS1737, CS0231, CS0225, CS1741, CS1751; a
 *                   default value is a constant of the parameter type (CS1736, CS1750)
 *   conversion      converted to a delegate type that does not declare the same default, or does not declare
 *                   `params`, the lambda keeps working with the delegate's signature: warnings CS9099 and CS9100
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { RefKind } from '../symbols/types.js';
import { naturalDelegateType } from '../conversions/method-group.js';
import { delegateInvoke } from '../overload/type-inference.js';
import { synthesizedDelegateOf } from '../symbols/synthesized/delegates.js';
import { parameterListRows } from './members/basic-declarations.js';

function refKindOf(parameter) {
  const modifiers = parameter.modifiers?.map(token => token.text) ?? [];
  if (modifiers.includes('out')) return RefKind.Out;
  if (modifiers.includes('ref')) return modifiers.includes('readonly') ? RefKind.RefReadOnlyParameter : RefKind.Ref;
  return modifiers.includes('in') ? RefKind.In : RefKind.None;
}

const isNullConstant = constant => constant === undefined || constant === null || constant.isNull || constant.value === null;
/** How a default value is shown in CS9099. */
const defaultText = constant => (isNullConstant(constant) ? 'null' : String(constant.value));
const sameDefault = (left, right) => (isNullConstant(left) ? isNullConstant(right) : !isNullConstant(right) && left.value === right.value);

/** True when a signature needs a delegate type of its own: `Action` and `Func` cannot express it. */
const needsSynthesizedType = signature =>
  signature.some(parameter => parameter.refKind !== RefKind.None || parameter.isOptional || parameter.isParams);

/** Class mixin of the body binder: lambda signatures and natural function types. */
export const LambdaSignatureBinding = Base =>
  class extends Base {
    /**
     * The parameters of an explicitly typed lambda, with the declaration errors of the list reported.
     * @param {object[]} parameterSyntax the parameter nodes  @param {object[]} types their bound types
     * @param {object|null} list the parameter list (its closing token carries CS1737)
     * @returns {{type, refKind, isParams, isOptional, defaultValue, syntax}[]}
     */
    lambdaSignature(parameterSyntax, types, list) {
      const signature = parameterSyntax.map((syntax, index) => {
        const parameter = {
          name: syntax.identifier.valueText,
          type: types[index],
          refKind: refKindOf(syntax),
          isParams: !!syntax.modifiers?.some(token => token.text === 'params'),
          defaultSyntax: syntax.default?.value ?? null,
          locations: [syntax.identifier],
          syntax,
        };
        // Bound like the default of a method parameter: a constant (CS1736) that converts to the type (CS1750).
        if (parameter.defaultSyntax && !parameter.type.isErrorType()) this.d.bindParameterDefault(parameter, this);
        return { ...parameter, isOptional: !!parameter.defaultSyntax, defaultValue: parameter.explicitDefaultValue };
      });
      for (const row of parameterListRows(null, signature, list)) this.report(row.at, row.code, row.args);
      return signature;
    }
    /** The natural type of a function with the given parameters and return type. */
    functionType(signature, returnType) {
      const types = signature.map(parameter => parameter.type);
      if (types.some(type => !type || type.isErrorType?.())) return null;
      const standard = needsSynthesizedType(signature) ? null : naturalDelegateType(this.core, types, returnType);
      return standard ?? synthesizedDelegateOf(this.d, this.core, signature, returnType?.isErrorType?.() ? this.core.void : (returnType ?? this.core.void));
    }
    /** The natural type of a method group with exactly one method: its signature, defaults and `params` included. */
    naturalGroupType(group) {
      const method = group.methods[0];
      this.d.ensureParameterDefaults(method.originalDefinition ?? method);
      const signature = method.parameters.map(parameter => ({
        type: parameter.type,
        refKind: parameter.refKind ?? RefKind.None,
        isParams: !!parameter.isParams,
        isOptional: !!parameter.isOptional && !parameter.isParams,
        defaultValue: parameter.explicitDefaultValue,
      }));
      return this.functionType(signature, method.returnsVoid ? this.core.void : method.returnType);
    }
    /** Binding a lambda for its final delegate type also compares the defaults and `params` the two declare. */
    finishLambda(lambda, delegateType) {
      const first = !lambda.finished;
      super.finishLambda(lambda, delegateType);
      if (first && lambda.signature) this.checkLambdaDefaults(lambda.signature, delegateType);
    }
    checkLambdaDefaults(signature, delegateType) {
      const invoke = delegateInvoke(delegateType),
        target = invoke?.parameters ?? [];
      if (invoke) this.d.ensureParameterDefaults(invoke.originalDefinition ?? invoke);
      signature.forEach((parameter, index) => {
        const declared = target[index];
        if (!declared) return;
        if (parameter.isOptional && !(declared.isOptional && sameDefault(parameter.defaultValue, declared.explicitDefaultValue))) {
          const theirs = declared.isOptional ? defaultText(declared.explicitDefaultValue) : '<missing>';
          this.report(parameter.syntax.identifier, DiagnosticId.CS9099, [index + 1, defaultText(parameter.defaultValue), theirs]);
        }
        if (parameter.isParams && !declared.isParams) this.report(parameter.syntax.identifier, DiagnosticId.CS9100, [index + 1]);
      });
    }
  };
