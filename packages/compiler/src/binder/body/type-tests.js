/**
 * `is`, `as`, tuples, null-conditional access (lifted to Nullable<T> for value results), await and throw.
 */
import { SymbolKind, TypeKind, ErrorTypeSymbol } from '../../symbols/types.js';
import { ConversionKind } from '../../conversions/classify.js';
import { isNullableType, stripNullable } from '../../conversions/nullable.js';
import { typeTestOutcome, asOperatorTargetValid } from '../../conversions/reference.js';
import { delegateInvoke } from '../../overload/type-inference.js';
import { lookupMembers } from '../inheritance.js';

const unknown = ErrorTypeSymbol.unknown;
const isSource = symbol => {
  for (let s = symbol?.originalDefinition ?? symbol; s; s = s.containingSymbol) if (s.isSource || s.containingAssembly) return true;
  return false;
};

/** Class mixin: `is`, `as`, tuples, null-conditional access (lifted to Nullable<T> for value results), await and throw. */
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
        type = this.bindType(typeSyntax).type;
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
          this.report(syntax, 'CS0184', [this.display(type)]);
        }
        return this.node('Is', syntax, this.core.bool, { operand, testedType: type });
      }
      const outcome = typeTestOutcome(operand.type, type, this.core);
      if (outcome === 'never') {
        const c = this.conversions.classifyExplicit(operand.type, type);
        if (!c.exists || c.isUserDefined || c.kind === ConversionKind.ExplicitNumeric || c.kind === ConversionKind.ImplicitNumeric)
          this.report(syntax, 'CS0184', [this.display(type)]);
      } else if (outcome === 'always' && operand.type.isValueType === true && !isNullableType(operand.type))
        this.report(syntax, 'CS0183', [this.display(type)]);
      return this.node('Is', syntax, this.core.bool, { operand, testedType: type, outcome });
    }
    tryConstantPattern(syntax, operand) {
      const saved = this.quiet;
      this.quiet = [];
      try {
        const e = this.expression(syntax);
        if (e.hasErrors || e.kind === 'TypeExpression' || !e.constantValue) return null;
        return { kind: 'ConstantPattern', syntax, value: operand.type ? this.convertQuiet(e, operand.type) : e };
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
          type.typeKind === TypeKind.TypeParameter ? 'CS0413' : 'CS0077',
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
            type.typeKind === TypeKind.TypeParameter;
        if (!allowed) {
          this.report(syntax, 'CS0039', [this.display(operand.type), this.display(type)]);
          return this.bad(syntax);
        }
      } else if (operand.kind === 'MethodGroup' || operand.form === 'lambda') {
        this.report(syntax, 'CS0837');
        return this.bad(syntax);
      }
      return this.node('As', syntax, type, { operand, targetType: type });
    }
    tuple(syntax) {
      const elements = syntax.arguments.map(a => this.value(a.expression)),
        names = syntax.arguments.map(a => a.nameColon?.name.identifier.valueText ?? null);
      if (elements.some(e => e.hasErrors)) return this.bad(syntax);
      const typed = elements.every(e => e.type && e.type.specialType !== 'System_Void');
      let type = null;
      if (typed && elements.length >= 2 && elements.length <= 7) {
        const t = this.core.bridge.coreType('System_ValueTuple_T' + elements.length).construct(elements.map(e => e.type));
        type = names.some(Boolean) ? t.withTupleElementNames(names) : t;
      } else if (elements.length > 7) return this.lenient(syntax);
      return this.node('Tuple', syntax, type, { elements, names, form: 'tupleLiteral' });
    }
    conditionalAccess(syntax) {
      // a?.b : the receiver is evaluated once; a value-typed result is lifted to Nullable<T> (SF-A02-B03).
      const receiver = this.value(syntax.expression);
      if (receiver.hasErrors) return this.bad(syntax);
      const type = receiver.type;
      if (!type || receiver.kind === 'MethodGroup') {
        this.report(syntax.operatorToken, 'CS0023', ['?', this.operandDisplay(receiver)]);
        return this.bad(syntax);
      }
      if (type.isValueType === true && !isNullableType(type)) {
        this.report(syntax.operatorToken, 'CS0023', ['?', this.display(type)]);
        return this.bad(syntax);
      }
      const placeholder = this.node('ConditionalReceiver', syntax.expression, isNullableType(type) ? stripNullable(type) : type, {});
      const access = this.whenNotNull(syntax.whenNotNull, placeholder);
      if (access.hasErrors) return this.bad(syntax);
      const t = access.type;
      let result;
      if (!t || t.specialType === 'System_Void') result = this.core.void;
      else if (t.isValueType === true && !isNullableType(t)) result = this.core.nullableOf(t);
      else if (t.typeKind === TypeKind.TypeParameter && t.isReferenceType !== true && t.isValueType !== true) {
        this.report(syntax.whenNotNull, 'CS8978', [t.name]);
        return this.bad(syntax);
      } else result = t;
      return this.node('ConditionalAccess', syntax, result, { receiver, whenNotNull: access, isLifted: result !== t });
    }
    whenNotNull(syntax, receiver) {
      switch (syntax.kind) {
        case 'MemberBindingExpression': {
          const name = syntax.name.identifier.valueText;
          return this.instanceMember(receiver, receiver.type, name, syntax.name, syntax, this.typeArgumentsOf(syntax.name), {});
        }
        case 'ElementBindingExpression':
          return this.lenient(syntax);
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
          if (target.hasErrors) return target;
          if (target.kind === 'MethodGroup') return this.call(target, args, syntax);
          const invoke = target.type ? delegateInvoke(target.type) : null;
          if (invoke) {
            const r = this.d.overloads.resolve([invoke], args, { isDelegate: true });
            if (r.succeeded) return this.finishCall(r, target, args, syntax, { isDelegateInvoke: true });
          }
          return this.lenient(syntax);
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
    asValueOrGroup(e) {
      return e.kind === 'MethodGroup' ? this.bad(e.syntax) : e;
    }
    await(syntax) {
      const operand = this.value(syntax.expression);
      if (!this.c.isAsync && !this.c.isTopLevel) {
        this.report(
          syntax,
          this.c.isLambda
            ? 'CS4034'
            : this.c.method?.returnsVoid !== false && this.c.method?.returnType?.specialType === 'System_Void'
              ? 'CS4033'
              : 'CS4032',
          this.c.isLambda ? ['lambda expression'] : this.c.method?.returnsVoid ? [] : [this.display(this.c.method?.returnType)],
        );
        return this.bad(syntax);
      }
      if (operand.hasErrors || !operand.type) return this.bad(syntax);
      const t = operand.type;
      if (t.originalDefinition === this.core.taskT || (t.originalDefinition?.name === 'ValueTask' && t.typeArguments?.length === 1))
        return this.node('Await', syntax, t.typeArguments[0].type, { operand });
      if (t.equals(this.core.task) || t.name === 'ValueTask') return this.node('Await', syntax, this.core.void, { operand });
      const getAwaiter = lookupMembers(t, 'GetAwaiter', this.core, { within: this.c.containingType }).members.find(
        m => m.kind === SymbolKind.Method && !m.parameters.length,
      );
      if (getAwaiter) {
        const result = lookupMembers(getAwaiter.returnType, 'GetResult', this.core, {}).members.find(m => m.kind === SymbolKind.Method);
        return this.node('Await', syntax, result?.returnType ?? unknown, { operand, getAwaiter });
      }
      // A registry type may have an awaiter the registry does not list; a predefined type has none.
      if (!isSource(t) && !t.specialType) return this.lenient(syntax);
      this.report(syntax, 'CS1061', [this.display(t), 'GetAwaiter']);
      return this.bad(syntax);
    }
    /** A thrown value converts implicitly to System.Exception (CS0029/CS0266 otherwise). */
    checkThrown(e, node) {
      if (e.hasErrors || e.literal === 'null' || e.type?.typeKind === TypeKind.TypeParameter) return;
      this.convert(e, this.core.exception, node);
    }
  };
