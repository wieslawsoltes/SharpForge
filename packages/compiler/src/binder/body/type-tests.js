/**
 * `is`, `as`, null-conditional access (lifted to Nullable<T> for value results), await and throw.
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { reportAwaitOutsideAsync } from '../async.js';
import { SymbolKind, TypeKind, ErrorTypeSymbol } from '../../symbols/types.js';
import { ConversionKind } from '../../conversions/classify.js';
import { isNullableType, stripNullable } from '../../conversions/nullable.js';
import { typeTestOutcome, asOperatorTargetValid } from '../../conversions/reference.js';
import { delegateInvoke } from '../../overload/type-inference.js';
import { resolveAwaitable, untypedAwaitOperand } from '../await.js';
import { lookupMembers } from '../inheritance.js';

const unknown = ErrorTypeSymbol.unknown;
const isSource = symbol => {
  for (let s = symbol?.originalDefinition ?? symbol; s; s = s.containingSymbol) if (s.isSource || s.containingAssembly) return true;
  return false;
};

/**
 * A qualified name read as the member access it may also be. After `is` the parser cannot tell `x is A.B` (a type)
 * from a constant (`x is Color.Red`, `n is Limits.Max`), and gives the name as a type; the constant is found by
 * binding the same tokens as an expression.
 */
function asMemberAccess(syntax) {
  if (syntax.kind !== 'QualifiedName') return syntax;
  return Object.create(syntax, {
    kind: { value: 'SimpleMemberAccessExpression' },
    expression: { value: asMemberAccess(syntax.left) },
    name: { value: syntax.right },
    operatorToken: { value: syntax.dotToken },
  });
}

/** Class mixin: `is`, `as`, null-conditional access (lifted to Nullable<T> for value results), await and throw. */
export const TypeTestBinding = Base =>
  class extends Base {
    isExpression(syntax) {
      const operand = this.value(syntax.expression ?? syntax.left);
      if (syntax.kind === 'IsPatternExpression') {
        const pattern = this.pattern(syntax.pattern, operand.type, operand);
        return this.node('IsPattern', syntax, this.core.bool, { operand, pattern });
      }
      // `e is T` parses as a type test; a constant on the right is a constant pattern.
      const typeSyntax = syntax.right ?? syntax.type;
      const saved = this.quiet;
      this.quiet = [];
      let type;
      try {
        // The first attempt reports nothing: when the name is no type it may still be a constant.
        type = this.bindType(typeSyntax, { quiet: true }).type;
      } finally {
        this.quiet = saved;
      }
      if (type.isErrorType()) {
        const asExpr = this.tryConstantPattern(typeSyntax, operand);
        if (asExpr) return this.node('IsPattern', syntax, this.core.bool, { operand, pattern: asExpr });
        type = this.bindType(typeSyntax).type;
        return this.bad(syntax);
      }
      if (operand.hasErrors) return this.bad(syntax);
      return this.typeTest(syntax, operand, type);
    }
    typeTest(syntax, operand, type) {
      if (!operand.type) {
        if (operand.literal === 'null') {
          this.report(syntax, DiagnosticId.CS0184, [this.display(type)]);
        }
        return this.node('Is', syntax, this.core.bool, { operand, testedType: type });
      }
      const outcome = typeTestOutcome(operand.type, type, this.core);
      if (outcome === 'never') {
        const c = this.conversions.classifyExplicit(operand.type, type);
        if (!c.exists || c.isUserDefined || c.kind === ConversionKind.ExplicitNumeric || c.kind === ConversionKind.ImplicitNumeric)
          this.report(syntax, DiagnosticId.CS0184, [this.display(type)]);
      } else if (outcome === 'always' && operand.type.isValueType === true && !isNullableType(operand.type))
        this.report(syntax, DiagnosticId.CS0183, [this.display(type)]);
      return this.node('Is', syntax, this.core.bool, { operand, testedType: type, outcome });
    }
    tryConstantPattern(syntax, operand) {
      const saved = this.quiet;
      this.quiet = [];
      try {
        const e = this.expression(asMemberAccess(syntax));
        if (e.hasErrors || e.kind === 'TypeExpression' || !e.constantValue) return null;
        const conversion = operand.type ? this.conversions.classifyFromExpression(e, operand.type) : null;
        return { kind: 'ConstantPattern', syntax, value: conversion?.exists ? this.constantPatternValue(e, operand.type, conversion) : e };
      } finally {
        this.quiet = saved;
      }
    }
    asExpression(syntax) {
      const operand = this.value(syntax.left ?? syntax.expression),
        type = this.bindType(syntax.right ?? syntax.type).type;
      if (operand.hasErrors || type.isErrorType()) return this.bad(syntax);
      if (!asOperatorTargetValid(type)) {
        this.report(
          syntax,
          type.typeKind === TypeKind.TypeParameter ? DiagnosticId.CS0413 : DiagnosticId.CS0077,
          type.typeKind === TypeKind.TypeParameter ? [type.name] : [this.display(type)],
        );
        return this.bad(syntax);
      }
      if (operand.type) {
        const c = this.conversions.classifyStandardExplicit(operand.type, type),
          allowed =
            (c.exists &&
              [
                ConversionKind.Identity,
                ConversionKind.ImplicitReference,
                ConversionKind.Boxing,
                ConversionKind.ExplicitReference,
                ConversionKind.Unboxing,
                ConversionKind.ImplicitNullable,
                ConversionKind.ExplicitNullable,
              ].includes(c.kind) &&
              !(c.isNullable && !stripNullable(operand.type).equals(stripNullable(type)))) ||
            operand.type.typeKind === TypeKind.TypeParameter ||
            operand.type.typeKind === TypeKind.Dynamic ||
            type.typeKind === TypeKind.TypeParameter;
        if (!allowed) {
          this.report(syntax, DiagnosticId.CS0039, [this.display(operand.type), this.display(type)]);
          return this.bad(syntax);
        }
      } else if (operand.kind === 'MethodGroup' || operand.form === 'lambda') {
        this.report(syntax, DiagnosticId.CS0837);
        return this.bad(syntax);
      }
      return this.node('As', syntax, type, { operand, targetType: type });
    }
    conditionalAccess(syntax) {
      // a?.b : the receiver is evaluated once; a value-typed result is lifted to Nullable<T> (SF-A02-B03).
      const receiver = this.value(syntax.expression);
      if (receiver.hasErrors) return this.bad(syntax);
      const type = receiver.type;
      if (receiver.kind === 'MethodGroup' && receiver.methods?.length) {
        this.report(syntax.expression, DiagnosticId.CS0119, [receiver.methods[0].toDisplayString(), 'method']);
        return this.bad(syntax);
      }
      if (!type || receiver.kind === 'MethodGroup') {
        this.report(syntax.operatorToken, DiagnosticId.CS0023, ['?', this.operandDisplay(receiver)]);
        return this.bad(syntax);
      }
      if (type.isValueType === true && !isNullableType(type)) {
        this.report(syntax.operatorToken, DiagnosticId.CS0023, ['?', this.display(type)]);
        return this.bad(syntax);
      }
      const placeholder = this.node('ConditionalReceiver', syntax.expression, isNullableType(type) ? stripNullable(type) : type, {});
      const access = this.whenNotNull(syntax.whenNotNull, placeholder);
      if (access.hasErrors) return this.bad(syntax);
      if (access.kind === 'MethodGroup') {
        // `a?.M` without a call: a method group has no nullable form.
        this.report(syntax.whenNotNull, DiagnosticId.CS8978, ['method group']);
        return this.bad(syntax);
      }
      const t = access.type;
      let result;
      if (!t || t.specialType === 'System_Void') result = this.core.void;
      else if (t.isValueType === true && !isNullableType(t)) result = this.core.nullableOf(t);
      else if (syntax.parent?.kind === 'ExpressionStatement') result = t;
      else if (t.typeKind === TypeKind.TypeParameter && t.isReferenceType !== true && t.isValueType !== true) {
        this.report(syntax.whenNotNull, DiagnosticId.CS8978, [t.name]);
        return this.bad(syntax);
      } else result = t;
      return this.node('ConditionalAccess', syntax, result, { receiver, whenNotNull: access, isLifted: result !== t });
    }
    whenNotNull(syntax, receiver) {
      switch (syntax.kind) {
        case 'MemberBindingExpression': {
          // A missing member is reported on the whole binding (`.Name`), the form Roslyn names.
          const name = syntax.name.identifier.valueText;
          return this.instanceMember(receiver, receiver.type, name, syntax, syntax, this.typeArgumentsOf(syntax.name), {});
        }
        case 'ElementBindingExpression':
          return this.elementAccessOn(receiver, this.arguments(syntax.argumentList), syntax);
        case 'ElementAccessExpression': {
          const left = this.asValueOrGroup(this.whenNotNull(syntax.expression, receiver));
          return left.hasErrors ? left : this.elementAccessOn(left, this.arguments(syntax.argumentList), syntax);
        }
        case 'SimpleMemberAccessExpression': {
          const left = this.asValueOrGroup(this.whenNotNull(syntax.expression, receiver));
          if (left.hasErrors) return left;
          return this.instanceMember(
            left,
            left.type,
            syntax.name.identifier.valueText,
            syntax.name,
            syntax,
            this.typeArgumentsOf(syntax.name),
            {},
          );
        }
        case 'InvocationExpression': {
          const target = this.whenNotNull(syntax.expression, receiver),
            args = this.arguments(syntax.argumentList);
          return target.hasErrors ? target : this.invokeConditional(target, args, syntax);
        }
        case 'ConditionalAccessExpression': {
          const inner = this.asValueOrGroup(this.whenNotNull(syntax.expression, receiver));
          if (inner.hasErrors) return inner;
          const p = this.node(
            'ConditionalReceiver',
            syntax.expression,
            isNullableType(inner.type) ? stripNullable(inner.type) : inner.type,
            {},
          );
          const access = this.whenNotNull(syntax.whenNotNull, p);
          return access.hasErrors ? access : this.node('ConditionalAccess', syntax, access.type, { receiver: inner, whenNotNull: access });
        }
        default:
          return this.lenient(syntax);
      }
    }
    /** The invocation inside `a?.M(...)`: a method of the receiver or a delegate-typed member. */
    invokeConditional(target, args, syntax) {
      if (target.kind === 'MethodGroup') return this.call(target, args, syntax);
      const invoke = target.type ? delegateInvoke(target.type) : null;
      if (invoke) {
        const r = this.d.overloads.resolve([invoke], args, { isDelegate: true });
        if (r.succeeded) return this.finishCall(r, target, args, syntax, { isDelegateInvoke: true });
      }
      return this.lenient(syntax);
    }
    asValueOrGroup(e) {
      return e.kind === 'MethodGroup' ? this.bad(e.syntax) : e;
    }
    await(syntax) {
      const operand = this.value(syntax.expression);
      if (reportAwaitOutsideAsync(this, syntax)) return this.bad(syntax);
      if (this.inUnsafeContext) this.report(syntax, DiagnosticId.CS4004);
      if (operand.hasErrors) return this.bad(syntax);
      const untyped = untypedAwaitOperand(operand);
      if (untyped || !operand.type) {
        this.report(syntax, untyped ? DiagnosticId.CS4001 : DiagnosticId.CS8716, untyped ? [untyped] : []);
        return this.bad(syntax);
      }
      const t = operand.type;
      // The awaiter of a dynamic value is found at run time, and so is the type of the result.
      if (t.typeKind === TypeKind.Dynamic) return this.node('Await', syntax, t, { operand, isDynamic: true });
      if (t.originalDefinition === this.core.taskT || (t.originalDefinition?.name === 'ValueTask' && t.typeArguments?.length === 1))
        return this.node('Await', syntax, t.typeArguments[0].type, { operand });
      if (t.equals(this.core.task) || t.name === 'ValueTask') return this.node('Await', syntax, this.core.void, { operand });
      // Any other type is awaited through the awaitable pattern (binder/await.js).
      const pattern = resolveAwaitable(this, operand);
      if (pattern.isUnknown) return this.lenient(syntax);
      if (pattern.error) {
        this.report(syntax, pattern.error.code, pattern.error.args);
        return this.bad(syntax);
      }
      for (const method of [pattern.getAwaiter, pattern.getResult]) if (method && !this.quiet) this.d.noteUse?.(method, this.c.uri, syntax);
      return this.node('Await', syntax, pattern.resultType ?? unknown, { operand, getAwaiter: pattern.getAwaiter, awaitable: pattern });
    }
    /** A thrown value converts implicitly to System.Exception (CS0029/CS0266 otherwise). */
    checkThrown(e, node) {
      if (e.hasErrors || e.literal === 'null' || e.type?.typeKind === TypeKind.TypeParameter) return;
      this.convert(e, this.core.exception, node);
    }
  };
