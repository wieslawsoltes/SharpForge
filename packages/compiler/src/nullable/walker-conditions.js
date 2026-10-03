/**
 * Null-state through conditions: the flow when a boolean expression is true and when it is false
 * (null tests, type tests and patterns, short-circuit operators and calls with conditional postconditions).
 */
import { NOT_NULL, MAYBE_NULL, joinFlow } from './flow-state.js';

const nullTestMethods = new Set(['IsNullOrEmpty', 'IsNullOrWhiteSpace']);

/** Class mixin (composed into the owning class by its index module). */
export const NullableConditions = Base =>
  class extends Base {
    // ---- conditions ----

    /** Walks a boolean expression and returns the flow when it is true and when it is false. */
    condition(node, flow) {
      if (!flow) return { whenTrue: null, whenFalse: null };
      const both = () => {
        this.expression(node, flow);
        return { whenTrue: flow, whenFalse: flow.clone() };
      };
      switch (node.kind) {
        case 'Binary':
          return this.binaryCondition(node, flow) ?? both();
        case 'Unary':
          if (node.operator === '!' && !node.method) {
            const inner = this.condition(node.operand, flow);
            return { whenTrue: inner.whenFalse, whenFalse: inner.whenTrue };
          }
          return both();
        case 'Is':
        case 'IsPattern':
          return this.typeTestCondition(node, flow);
        case 'Call':
          return this.callCondition(node, flow);
        case 'Conversion':
          return node.conversion?.kind === 'Identity' ? this.condition(node.operand, flow) : both();
        default:
          return both();
      }
    }

    binaryCondition(node, flow) {
      if (node.operator === '&&') {
        const left = this.condition(node.left, flow);
        const right = this.condition(node.right, left.whenTrue);
        return { whenTrue: right.whenTrue, whenFalse: joinFlow(left.whenFalse, right.whenFalse) };
      }
      if (node.operator === '||') {
        const left = this.condition(node.left, flow);
        const right = this.condition(node.right, left.whenFalse);
        return { whenTrue: joinFlow(left.whenTrue, right.whenTrue), whenFalse: right.whenFalse };
      }
      if (node.operator !== '==' && node.operator !== '!=') return null;
      const unwrap = operand => (operand.kind === 'Conversion' && operand.operand ? operand.operand : operand);
      const left = unwrap(node.left);
      const right = unwrap(node.right);
      const tested = this.isNullLiteral(right) ? left : this.isNullLiteral(left) ? right : null;
      if (!tested) return null;
      this.expression(tested, flow);
      const variable = this.variableOf(tested);
      const isNull = flow.clone();
      const isNotNull = flow.clone();
      if (variable) {
        isNull.set(variable, MAYBE_NULL);
        isNotNull.set(variable, NOT_NULL);
      }
      return node.operator === '==' ? { whenTrue: isNull, whenFalse: isNotNull } : { whenTrue: isNotNull, whenFalse: isNull };
    }

    typeTestCondition(node, flow) {
      this.expression(node.operand, flow);
      const variable = this.variableOf(node.operand);
      const matched = flow.clone();
      const unmatched = flow.clone();
      const pattern = node.pattern;
      const negated = pattern?.kind === 'NotPattern';
      const inner = negated ? pattern.pattern : pattern;
      const testsForNull = inner?.kind === 'ConstantPattern' && this.isNullLiteral(inner.value ?? {});
      if (variable) {
        if (testsForNull) {
          matched.set(variable, MAYBE_NULL);
          unmatched.set(variable, NOT_NULL);
        } else {
          // A successful type or declaration pattern proves the operand is not null.
          matched.set(variable, NOT_NULL);
        }
      }
      if (inner?.local) matched.set(inner.local, NOT_NULL);
      if (!testsForNull) this.learnFromSubpatterns(inner, variable, matched);
      return negated ? { whenTrue: unmatched, whenFalse: matched } : { whenTrue: matched, whenFalse: unmatched };
    }

    callCondition(node, flow) {
      this.call(node, flow);
      const whenTrue = flow;
      const whenFalse = flow.clone();
      const method = node.method;
      if (!method) return { whenTrue, whenFalse };
      for (const argument of node.args ?? []) {
        this.applyPostcondition(argument, true, whenTrue);
        this.applyPostcondition(argument, false, whenFalse);
      }
      this.applyMemberPostconditions(method, true, whenTrue, node.receiver);
      this.applyMemberPostconditions(method, false, whenFalse, node.receiver);
      // string.IsNullOrEmpty / IsNullOrWhiteSpace carry [NotNullWhen(false)] in the BCL.
      const isStringNullTest = nullTestMethods.has(method.name) && method.containingType?.specialType === 'System_String';
      const variable = isStringNullTest ? this.variableOf(node.args[0]?.expression ?? {}) : null;
      if (variable) whenFalse.set(variable, NOT_NULL);
      return { whenTrue, whenFalse };
    }
  };
