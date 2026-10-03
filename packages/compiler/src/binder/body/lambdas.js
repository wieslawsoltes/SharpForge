/**
 * Lambdas and anonymous methods (bound per candidate delegate type, cached, diagnostics reported once),
 * switch expressions and collection expressions.
 */
import { RefKind, ErrorTypeSymbol, ArrayTypeSymbol, NamedTypeSymbol } from '../../symbols/types.js';
import { ParameterSymbol } from '../../symbols/members.js';
import { Conversion, ConversionKind } from '../../conversions/classify.js';
import { naturalDelegateType } from '../../conversions/method-group.js';
import { delegateInvoke } from '../../overload/type-inference.js';
import { anonymousFunctionAnchor, anonymousMethodSignatureErrors } from '../anonymous-methods.js';

const unknown = ErrorTypeSymbol.unknown;

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
      const isAsync = (syntax.modifiers ?? []).some(m => m.text === 'async'),
        isStaticFunction = (syntax.modifiers ?? []).some(m => m.text === 'static'),
        cache = new Map();
      const node = this.node('Lambda', syntax, null, { form: 'lambda', isAnonymousMethod, parameterSyntax, isAsync });
      const bindWith = (parameterTypes, returnType, quiet, refKinds = null) => {
        const key = parameterTypes.map(t => t.toDisplayString()).join(',') + '=>' + (returnType ? returnType.toDisplayString() : '?');
        if (quiet && cache.has(key)) return cache.get(key);
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
            staticFunction: isStaticFunction ? 'lambda' : null,
            isFieldInitializer: false,
            isStatic: this.c.isStatic,
            quiet: quiet ? diagnostics : this.quiet,
            inferReturn: !returnType,
            isStaticInitializer: this.c.isStaticInitializer,
          });
        child.checked = this.checked;
        let body;
        if (syntax.block) body = child.block(syntax.block);
        else {
          // The body of a lambda is the expression itself; only member declarations wrap it in an arrow clause.
          const bodySyntax = syntax.expressionBody.kind === 'ArrowExpressionClause' ? syntax.expressionBody.expression : syntax.expressionBody;
          const e = child.expression(bodySyntax);
          if (returnType && returnType.specialType !== 'System_Void' && child.c.returnType) {
            const v = child.asValue(e);
            body = child.convert(v, child.c.returnType);
            if (v.form === 'lambda' && !body.hasErrors) child.finishLambda(v, child.c.returnType);
            child.returns.push(v);
          } else if (
            (child.c.returnType && child.c.returnType.specialType === 'System_Void') ||
            returnType?.specialType === 'System_Void'
          ) {
            body = e.kind === 'TypeExpression' ? child.asValue(e) : e;
            if (!body.hasErrors && !child.isStatementExpression(body.syntax)) child.report(body.syntax, 'CS0201');
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
            : (body.type ?? (body.hasErrors ? null : this.core.void))
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
        if (quiet) cache.set(key, result);
        return result;
      };
      node.lambda = {
        parameterTypes: explicit,
        inferReturnType: types => {
          if (parameterSyntax && types.length !== parameterSyntax.length) return null;
          const r = bindWith(explicit ?? types, null, true);
          return r.inferred && !r.inferred.isErrorType?.() ? r.inferred : null;
        },
      };
      node.convert = to => {
        const invoke = delegateInvoke(to);
        if (!invoke) {
          node.lastConversionError = null;
          return null;
        }
        const errors = [];
        const anchor = anonymousFunctionAnchor(syntax);
        if (parameterSyntax && parameterSyntax.length !== invoke.parameters.length) {
          node.lastConversionError = [{ node: anchor, code: 'CS1593', args: [this.display(to), parameterSyntax.length] }];
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
            { node: anchor, code: 'CS1661', args: [isAnonymousMethod ? 'anonymous method' : 'lambda expression', this.display(to)] },
            {
              node: isAnonymousMethod ? (parameterSyntax[i].identifier ?? parameterSyntax[i]) : parameterSyntax[i],
              code: 'CS1678',
              args: [i + 1, this.display(explicit[i]), this.display(invoke.parameters[i].type)],
            },
          ];
          return null;
        }
        const r = bindWith(
          invoke.parameters.map(p => p.type),
          invoke.returnType,
          true,
          invoke.parameters.map(p => p.refKind),
        );
        if (r.hasErrors) {
          node.lastConversionError = r.diagnostics.filter(d => this.d.isError(d.code));
          node.bodyErrors = true;
          return null;
        }
        // A block whose end is reachable returns nothing: it cannot become a delegate that returns a value.
        const returnsValue = invoke.returnType && invoke.returnType.specialType !== 'System_Void' && !invoke.returnType.isErrorType?.();
        if (syntax.block && r.body.completes && returnsValue && !isAsync && !r.child.usesGoto) {
          const what = isAnonymousMethod ? 'anonymous method' : 'lambda expression';
          const at = syntax.arrowToken ?? syntax.delegateKeyword ?? syntax;
          node.lastConversionError = [{ node: at, code: 'CS1643', args: [what, this.display(to)] }];
          node.bodyErrors = true;
          return null;
        }
        return new Conversion(ConversionKind.AnonymousFunction);
      };
      node.bindFinal = to => {
        const invoke = delegateInvoke(to);
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
        const r = bindWith(explicit, null, true);
        return r.inferred ? naturalDelegateType(this.core, explicit, r.inferred) : null;
      };
      return node;
    }
    unwrapTask(type) {
      if (type.originalDefinition === this.core.taskT) return type.typeArguments[0].type;
      if (type.equals(this.core.task)) return this.core.void;
      return type;
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
      const type = this.bestCommonType(arms.map(a => a.value));
      if (!type) return this.targetTypedSwitch(syntax, governing, arms);
      return this.node('SwitchExpression', syntax, type, {
        governing,
        arms: arms.map(a => ({ ...a, value: this.convert(a.value, type) })),
      });
    }
    collectionExpression(syntax) {
      const elements = syntax.elements.map(e =>
        e.kind === 'ExpressionElement'
          ? this.value(e.expression)
          : e.kind === 'SpreadElement'
            ? { spread: this.value(e.expression) }
            : null,
      );
      const n = this.node('CollectionExpression', syntax, null, { elements, form: 'collection' });
      n.convert = to => {
        const element =
          to instanceof ArrayTypeSymbol
            ? to.elementType
            : to instanceof NamedTypeSymbol && to.typeArguments.length === 1
              ? to.typeArguments[0].type
              : null;
        if (!element) return null;
        return elements.every(
          e =>
            !e ||
            e.spread ||
            e.hasErrors ||
            (() => {
              const c = this.conversions.classifyFromExpression(e, element);
              return c.exists && c.isImplicit;
            })(),
        )
          ? new Conversion(ConversionKind.CollectionExpression)
          : null;
      };
      n.materialize = to => this.node('CollectionExpression', syntax, to, { elements });
      return n;
    }
  };
