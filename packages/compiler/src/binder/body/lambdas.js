/**
 * Lambdas and anonymous methods (bound per candidate delegate type, cached, diagnostics reported once),
 * switch expressions and collection expressions.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { RefKind, TypeKind, ErrorTypeSymbol } from '../../symbols/types.js';
import { ParameterSymbol } from '../../symbols/members.js';
import { expressionTreeDelegate } from '../../symbols/expression-tree-types.js';
import { Conversion, ConversionKind } from '../../conversions/classify.js';
import { delegateInvoke } from '../../overload/type-inference.js';
import { asyncResultType } from '../csharp70.js';
import { anonymousFunctionAnchor, anonymousMethodSignatureErrors } from '../anonymous-methods.js';

const unknown = ErrorTypeSymbol.unknown;
const lambdaDelegate = (type, core) => type?.typeKind === TypeKind.Delegate ? type : expressionTreeDelegate(type, core);

/** The cache key of a lambda binding: its parameter types and return type (`?` while the return type is inferred). */
const signatureKey = (parameterTypes, returnType) =>
  parameterTypes.map(type => type.toDisplayString()).join(',') + '=>' + (returnType ? returnType.toDisplayString() : '?');

/**
 * True when an expression body bound for return type inference is also its binding for `returnType`: `convert`
 * returns such a value unchanged and reports nothing, so binding the body again would produce the same result.
 */
const returnsUnconverted = (body, returnType) =>
  !!body.type &&
  !body.hasErrors &&
  !body.literal &&
  !body.form &&
  !body.constantValue &&
  returnType.specialType !== 'System_Void' &&
  !returnType.isErrorType?.() &&
  body.type.equals(returnType);

/** Class mixin: Lambdas and anonymous methods (bound per candidate delegate type, cached, diagnostics reported once), */
export const LambdaBinding = Base =>
  class extends Base {
    // ---- lambdas ----
    lambda(syntax) {
      const isAnonymousMethod = syntax.kind === 'AnonymousMethodExpression',
        parameterSyntax = syntax.kind === 'SimpleLambdaExpression' ? [syntax.parameter] : (syntax.parameterList?.parameters ?? null);
      const explicit =
        parameterSyntax && parameterSyntax.length && parameterSyntax.every(p => p.type)
          ? parameterSyntax.map(p => this.bindType(p.type).type)
          : parameterSyntax && !parameterSyntax.length
            ? []
            : null;
      // C# 10: `int (bool b) => ...` declares the return type; it must then be the delegate's return type exactly.
      const returnSyntax = syntax.returnType?.kind === 'RefType' ? syntax.returnType.type : syntax.returnType,
        declaredReturn = returnSyntax ? this.bindType(returnSyntax).type : null;
      const isAsync = (syntax.modifiers ?? []).some(m => m.text === 'async'),
        isStaticFunction = (syntax.modifiers ?? []).some(m => m.text === 'static'),
        cache = new Map();
      // What the list declares beyond the types: reference kinds, default values and `params` (../lambda-signatures.js).
      const signature = explicit && !isAnonymousMethod ? this.lambdaSignature(parameterSyntax, explicit, syntax.parameterList ?? null) : null;
      const node = this.node('Lambda', syntax, null, { form: 'lambda', isAnonymousMethod, parameterSyntax, isAsync, signature });
      const bindWith = (parameterTypes, returnType, quiet, refKinds = null) => {
        const key = signatureKey(parameterTypes, returnType);
        const known = cache.get(key);
        if (known && quiet) return known;
        // Inside a speculative binding the final pass reports into the enclosing list and records no uses, which is
        // what the cached speculative result did: replay its diagnostics instead of binding the body again.
        if (known && this.quiet) {
          for (const diagnostic of known.diagnostics) this.quiet.push(diagnostic);
          return known;
        }
        const reusableForInference = quiet && returnType && !syntax.block && !isAsync && !syntax.isQueryLambda;
        if (reusableForInference) {
          const forInference = cache.get(signatureKey(parameterTypes, null));
          if (forInference && returnsUnconverted(forInference.body, returnType)) {
            cache.set(key, forInference);
            return forInference;
          }
        }
        this.d.lambdaBodyBindings = (this.d.lambdaBodyBindings ?? 0) + 1;
        // C# 9: when more than one parameter is named `_` they are discards, and `_` names none of them.
        const hasDiscards = (parameterSyntax ?? []).filter(p => p.identifier.valueText === '_').length > 1;
        const parameters = (parameterSyntax ?? []).map((p, i) => {
          const mods = p.modifiers?.map(m => m.text) ?? [];
          const s = new ParameterSymbol({
            name: p.identifier.valueText,
            type: parameterTypes[i] ?? unknown,
            ordinal: i,
            refKind: mods.includes('ref')
              ? RefKind.Ref
              : mods.includes('out')
                ? RefKind.Out
                : mods.includes('in')
                  ? RefKind.In
                  : (refKinds?.[i] ?? RefKind.None),
            syntax: p,
          });
          s.isDiscard = hasDiscards && s.name === '_';
          return s;
        });
        const diagnostics = [],
          child = new this.constructor(this.d, {
            ...this.c,
            parent: this,
            parameters,
            returnType: isAsync && returnType ? this.unwrapTask(returnType) : returnType,
            returnRefKind: RefKind.None,
            isAsync,
            isIterator: false,
            isLambda: true,
            isAnonymousMethod,
            staticFunction: isStaticFunction ? 'lambda' : null,
            isFieldInitializer: false,
            isStatic: this.c.isStatic,
            quiet: quiet ? diagnostics : this.quiet,
            inferReturn: !returnType,
            isStaticInitializer: this.c.isStaticInitializer,
          });
        child.checked = this.checked;
        let body,
          returnedUnconverted = false;
        if (syntax.block) body = child.block(syntax.block);
        else {
          // The body of a lambda is the expression itself; only member declarations wrap it in an arrow clause.
          const bodySyntax = syntax.expressionBody.kind === 'ArrowExpressionClause' ? syntax.expressionBody.expression : syntax.expressionBody;
          const e = child.expression(bodySyntax);
          if (returnType && returnType.specialType !== 'System_Void' && child.c.returnType) {
            const v = child.asValue(e);
            // A lambda the compiler builds for a query clause is not an anonymous function of the program (no CS1662).
            body = syntax.isQueryLambda ? child.convert(v, child.c.returnType) : child.convertReturned(v, child.c.returnType, bodySyntax);
            if (v.form === 'lambda' && !body.hasErrors) child.finishLambda(v, child.c.returnType);
            returnedUnconverted = body === v;
            child.returns.push(v);
          } else if (
            (child.c.returnType && child.c.returnType.specialType === 'System_Void') ||
            returnType?.specialType === 'System_Void'
          ) {
            body = e.kind === 'TypeExpression' ? child.asValue(e) : e;
            if (!body.hasErrors && !child.isStatementExpression(body.syntax)) child.report(body.syntax, DiagnosticId.CS0201);
          } else {
            body = child.asValue(e);
            child.returns.push(body);
          }
        }
        const inferred = child.c.inferReturn
          ? syntax.block
            ? child.returns.length
              ? child.bestCommonType(child.returns.filter(r => r))
              : child.sawReturn
                ? null
                : this.core.void
            : this.expressionBodyType(body)
          : null;
        const result = {
          body,
          diagnostics,
          hasErrors: diagnostics.some(d => this.d.isError(d.code)) || (!!body.hasErrors && !syntax.block),
          inferred:
            inferred && isAsync
              ? inferred.specialType === 'System_Void'
                ? this.core.task
                : this.core.taskT.construct(inferred)
              : inferred,
          child,
        };
        if (quiet) {
          cache.set(key, result);
          // The same body, bound again to infer the return type, would be this one and would infer `returnType`.
          const inferenceKey = signatureKey(parameterTypes, null);
          if (reusableForInference && returnedUnconverted && !cache.has(inferenceKey) && returnsUnconverted(body, returnType))
            cache.set(inferenceKey, { ...result, inferred: body.type });
        }
        return result;
      };
      node.lambda = {
        parameterTypes: explicit,
        inferReturnType: types => {
          if (parameterSyntax && types.length !== parameterSyntax.length) return null;
          if (declaredReturn) return declaredReturn.isErrorType() ? null : declaredReturn;
          const r = bindWith(explicit ?? types, null, true);
          return r.inferred && !r.inferred.isErrorType?.() ? r.inferred : null;
        },
      };
      node.convert = to => {
        const treeDelegate = expressionTreeDelegate(to, this.core);
        if (treeDelegate && treeDelegate.typeKind !== TypeKind.Delegate) {
          node.lastConversionError = [{ node: anonymousFunctionAnchor(syntax), code: DiagnosticId.CS0835, args: [this.display(treeDelegate)] }];
          return null;
        }
        if (treeDelegate && isAnonymousMethod) {
          node.lastConversionError = [{ node: syntax.delegateKeyword, code: DiagnosticId.CS1946, args: [] }];
          return null;
        }
        const invoke = delegateInvoke(lambdaDelegate(to, this.core));
        if (!invoke) {
          node.lastConversionError = null;
          return null;
        }
        const errors = [];
        const anchor = anonymousFunctionAnchor(syntax);
        if (parameterSyntax && parameterSyntax.length !== invoke.parameters.length) {
          node.lastConversionError = [{ node: anchor, code: DiagnosticId.CS1593, args: [this.display(to), parameterSyntax.length] }];
          return null;
        }
        const signatureErrors = anonymousMethodSignatureErrors(syntax, parameterSyntax, invoke);
        if (signatureErrors) {
          node.lastConversionError = signatureErrors;
          return null;
        }
        if (explicit && !explicit.every((t, i) => t.equals(invoke.parameters[i].type))) {
          const i = explicit.findIndex((t, k) => !t.equals(invoke.parameters[k].type));
          node.lastConversionError = [
            { node: anchor, code: DiagnosticId.CS1661, args: [isAnonymousMethod ? 'anonymous method' : 'lambda expression', this.display(to)] },
            {
              node: parameterSyntax[i].identifier ?? parameterSyntax[i],
              code: DiagnosticId.CS1678,
              // Roslyn's format has a reference-kind prefix in front of each of the two types.
              args: [i + 1, '', this.display(explicit[i]), '', this.display(invoke.parameters[i].type)],
            },
          ];
          return null;
        }
        if (declaredReturn && invoke.returnType && !declaredReturn.isErrorType() && !declaredReturn.equals(invoke.returnType)) {
          node.lastConversionError = [{ node: syntax.arrowToken ?? anchor, code: DiagnosticId.CS8934, args: ['lambda expression', this.display(to)] }];
          return null;
        }
        const r = bindWith(
          invoke.parameters.map(p => p.type),
          invoke.returnType,
          true,
          invoke.parameters.map(p => p.refKind),
        );
        if (r.hasErrors) {
          node.lastConversionError = this.withReturnMismatches(r, syntax);
          node.bodyErrors = true;
          return null;
        }
        // A block whose end is reachable returns nothing: it cannot become a delegate that returns a value.
        const returnsValue = invoke.returnType && invoke.returnType.specialType !== 'System_Void' && !invoke.returnType.isErrorType?.();
        if (syntax.block && r.body.completes && returnsValue && !isAsync && !r.child.usesGoto) {
          const what = isAnonymousMethod ? 'anonymous method' : 'lambda expression';
          const at = syntax.arrowToken ?? syntax.delegateKeyword ?? syntax;
          node.lastConversionError = [{ node: at, code: DiagnosticId.CS1643, args: [what, this.display(to)] }];
          node.bodyErrors = true;
          return null;
        }
        return new Conversion(ConversionKind.AnonymousFunction);
      };
      node.bindFinal = to => {
        const invoke = delegateInvoke(lambdaDelegate(to, this.core));
        return invoke
          ? bindWith(
              invoke.parameters.map(p => p.type),
              invoke.returnType,
              false,
              invoke.parameters.map(p => p.refKind),
            )
          : null;
      };
      // Natural type (C# 10): explicitly typed parameters and an inferable return type.
      node.naturalType = () => {
        if (!explicit) return null;
        const parameters = signature ?? explicit.map(type => ({ type, refKind: RefKind.None }));
        if (declaredReturn) return declaredReturn.isErrorType() ? null : this.functionType(parameters, declaredReturn);
        const r = bindWith(explicit, null, true);
        return r.inferred ? this.functionType(parameters, r.inferred) : null;
      };
      return node;
    }
    /**
     * The errors of a lambda body bound for a delegate type. A returned value that does not convert to the delegate's
     * return type is reported twice, as in Roslyn: the conversion error and CS1662 on the same expression.
     */
    withReturnMismatches(bound, syntax) {
      const errors = bound.diagnostics.filter(d => this.d.isError(d.code));
      // The lambdas a query expression is translated to are not written in source: only the conversion error is theirs.
      if (syntax.isQueryLambda) return errors;
      const returned = new Set(bound.child.returns.filter(Boolean).map(value => value.syntax)),
        what = syntax.kind === 'AnonymousMethodExpression' ? 'anonymous method' : 'lambda expression';
      return errors.flatMap(error =>
        [DiagnosticId.CS0029, DiagnosticId.CS0266].includes(error.code) && returned.has(error.node) ? [error, { node: error.node, code: DiagnosticId.CS1662, args: [what] }] : [error],
      );
    }
    /**
     * The type an expression body gives its lambda when the return type is inferred: the type of the expression, the
     * natural delegate type of a lambda or method group (C# 10), or null when it has none (`() => null`).
     */
    expressionBodyType(body) {
      if (body.type || body.hasErrors) return body.type ?? null;
      const isFunction = body.form === 'lambda' || body.kind === 'MethodGroup';
      return isFunction && this.version.number >= 10 ? this.naturalFunctionType(body) : null;
    }
    /** What the `return` statements of an async lambda produce for a delegate return type: `T` of any task-like type. */
    unwrapTask(type) {
      return asyncResultType(type, this.core) ?? type;
    }
    /** Binds the body of a lambda for the delegate type it was converted to, reporting its diagnostics once. */
    finishLambda(lambda, delegateType) {
      if (lambda.finished) return;
      lambda.finished = true;
      const r = lambda.bindFinal(delegateType);
      if (r) {
        lambda.body = r.body;
        lambda.boundAs = delegateType;
        // Lowering needs the symbols the body was bound with: its parameters and the locals it declares.
        lambda.parameters = r.child.c.parameters;
        lambda.locals = r.child.locals;
      }
    }
    switchExpression(syntax) {
      const governing = this.value(syntax.governingExpression),
        arms = [];
      for (const arm of syntax.arms) {
        this.pushScope();
        const pattern = governing.hasErrors ? null : this.pattern(arm.pattern, governing.type, governing);
        const when = arm.whenClause ? this.condition(arm.whenClause.condition) : null;
        arms.push({ pattern, when, value: this.value(arm.expression), syntax: arm });
        this.popScope();
      }
      if (governing.hasErrors || arms.some(a => a.value.hasErrors)) return this.bad(syntax);
      this.reportSwitchArms(
        governing.type,
        arms.map(a => ({ pattern: a.pattern, when: a.when, node: a.syntax.pattern })),
        { isExpression: true, node: syntax.switchKeyword },
      );
      // The natural type is the best common type of the arms, provided every arm converts to it: in
      // `x switch { 1 => State.On, _ => null }` the `null` does not, and the type comes from the target (`State?`).
      const common = this.bestCommonType(arms.map(a => a.value)),
        converts = value => {
          const conversion = this.conversions.classifyFromExpression(value, common);
          return conversion.exists && conversion.isImplicit;
        },
        type = common && arms.every(a => converts(a.value)) ? common : null;
      if (!type) return this.targetTypedSwitch(syntax, governing, arms);
      return this.node('SwitchExpression', syntax, type, {
        governing,
        arms: arms.map(a => ({ ...a, value: this.convert(a.value, type) })),
      });
    }
  };
