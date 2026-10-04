/**
 * Lowering of null-conditional access (SF-A02-T59): `receiver?.access`.
 *
 * The receiver is evaluated once into a temporary that `ConditionalReceiver` reads. Three results are possible:
 *
 *   statement      a?.M();          t = a; if (t != null) t.M();
 *   reference      a?.Name          t = a; t != null ? t.Name : null
 *   value type     a?.Count         a `Nullable<T>` in C#, which the runtime cannot represent
 *
 * A value-typed result is therefore lowered together with the expression that consumes it, in the forms that never
 * need the nullable value itself. The access leaves its value in a temporary and sets an `absent` flag instead of
 * producing null (a chain `a?.b?.c` shares one flag), and the consumer reads both:
 *
 *   a?.Count ?? d            absent ? d : value
 *   a?.Count == x, != x      !absent && value == x      absent || value != x        (x evaluated after the access)
 *   a?.Count < x  (> <= >=)  !absent && value < x
 *   a?.Count == null         absent                     (the access still runs when the receiver is not null)
 *   (object)a?.Count, "s" + a?.Count                     absent ? null : box(value)
 *   $"{a?.Count,4:D3}"                                   absent ? format(null) : format(value)
 *
 * Anywhere else a value-typed result is reported as unsupported ("nullable value types"), never miscompiled.
 */
import { n } from '../codegen/semantic/node-factory.js';

const boxedTypes = new Set(['int', 'double', 'bool']);
const comparisons = new Set(['==', '!=', '<', '>', '<=', '>=']);

const isLiftedAccess = node => node?.kind === 'ConditionalAccess' && node.isLifted === true;
const isNullOperand = node => node.literal === 'null' || (node.kind === 'Conversion' && node.conversion?.kind === 'NullLiteral');
/** The non-nullable operand under an implicit `T -> T?` conversion, or null when the operand is not one. */
const underNullable = node =>
  node.kind === 'Conversion' && node.conversion?.kind === 'ImplicitNullable' && node.conversion.underlying?.kind === 'Identity' ? node.operand : null;

/** The conditional accesses of one chain: the node and every access in tail position (`a?.b?.c` is two). */
function chainOf(node) {
  const chain = new Set();
  for (let current = node; current?.kind === 'ConditionalAccess'; current = current.whenNotNull) chain.add(current);
  return chain;
}

/** Translator mixin: null-conditional access and the consumers of its value-typed results. */
export const ConditionalAccessLowering = Base =>
  class extends Base {
    exprConditionalAccess(node) {
      return this.conditionalAccess(node, false);
    }
    /** `receiver?.access` as a statement (`discard`) or as a value. */
    conditionalAccess(node, discard) {
      const receiver = this.expression(node.receiver),
        temp = this.temp(receiver.legacyType, 'receiver'),
        saved = this.conditionalReceiver;
      this.conditionalReceiver = () => n.local(temp);
      let access;
      try {
        access = discard ? this.effect(node.whenNotNull) : this.expression(node.whenNotNull);
      } finally {
        this.conditionalReceiver = saved;
      }
      const hasValue = n.notEquals(n.local(temp), n.nullLiteral(receiver.legacyType)),
        store = [n.assign(n.local(temp), receiver)];
      if (discard) {
        const done = n.sequence([], [access], n.nullLiteral('object'));
        return n.sequence([temp], store, n.conditional(hasValue, done, n.nullLiteral('object'), 'object'));
      }
      const whenNull = this.types.isReference(access.legacyType) ? n.nullLiteral(access.legacyType) : this.absentValue(node, access.legacyType);
      return n.sequence([temp], store, n.conditional(hasValue, access, whenNull, access.legacyType));
    }
    /** What a value-typed access yields for a null receiver: it sets the chain's flag; the value itself is not read. */
    absentValue(node, type) {
      const lifted = this.liftedChain;
      if (!lifted?.chain.has(node)) return this.unsupported('nullable value types', node.syntax);
      return n.sequence([], [n.assign(n.local(lifted.absent), n.literal(true, 'bool'))], this.defaultValue(type));
    }
    /**
     * Lowers a value-typed conditional access for a consumer that handles the null case itself.
     * @returns {{locals: object[], effects: object[], value: () => object, absent: () => object}}
     */
    liftedAccess(node) {
      const absent = this.temp('bool', 'absent'),
        saved = this.liftedChain;
      this.liftedChain = { absent, chain: chainOf(node) };
      let access;
      try {
        access = this.conditionalAccess(node, false);
      } finally {
        this.liftedChain = saved;
      }
      const value = this.temp(access.legacyType, 'value');
      return {
        locals: [absent, value],
        effects: [n.assign(n.local(absent), n.literal(false, 'bool')), n.assign(n.local(value), access)],
        value: () => n.local(value),
        absent: () => n.local(absent),
      };
    }
    /** `a?.b ?? d` with a value-typed `b`. */
    exprCoalesce(node) {
      if (!isLiftedAccess(node.left) || node.leftConversion) return super.exprCoalesce(node);
      const access = this.liftedAccess(node.left),
        type = this.imageType(node.type, node.syntax);
      if (this.types.isReference(type) || access.value().legacyType !== type) return this.unsupported('nullable value types', node.syntax);
      return n.sequence(access.locals, access.effects, n.conditional(access.absent(), this.expression(node.right), access.value(), type));
    }
    /** A comparison of a value-typed access with a non-nullable value or with `null`. */
    exprBinary(node) {
      const fused = node.isLifted && comparisons.has(node.operator) ? this.liftedComparison(node) : null;
      return fused ?? super.exprBinary(node);
    }
    liftedComparison(node) {
      const accessIsLeft = isLiftedAccess(node.left),
        accessNode = accessIsLeft ? node.left : node.right,
        other = accessIsLeft ? node.right : node.left;
      if (!isLiftedAccess(accessNode)) return null;
      const isEquality = node.operator === '==' || node.operator === '!=';
      if (isNullOperand(other)) {
        if (!isEquality) return null;
        const access = this.liftedAccess(accessNode);
        return n.sequence(access.locals, access.effects, node.operator === '==' ? access.absent() : n.not(access.absent()));
      }
      const operand = underNullable(other);
      if (!operand) return null;
      // Operands are evaluated left to right, whichever side the access is on.
      const first = accessIsLeft ? null : this.once(this.expression(operand), 'left'),
        access = this.liftedAccess(accessNode),
        second = accessIsLeft ? this.once(this.expression(operand), 'right') : null,
        value = (first ?? second).read(),
        compare = accessIsLeft ? n.binary(node.operator, access.value(), value, 'bool') : n.binary(node.operator, value, access.value(), 'bool'),
        result = node.operator === '!=' ? n.logicalOr(access.absent(), compare) : n.logicalAnd(n.not(access.absent()), compare);
      return n.sequence(
        [...(first?.locals ?? []), ...access.locals, ...(second?.locals ?? [])],
        [...(first?.effects ?? []), ...access.effects, ...(second?.effects ?? [])],
        result,
      );
    }
    /** `(object)a?.Count`: null, or the boxed value. */
    exprConversion(node) {
      if (node.conversion?.kind === 'Boxing' && isLiftedAccess(node.operand)) return this.boxedOrNull(node.operand);
      return super.exprConversion(node);
    }
    /** An interpolation hole: a value-typed access is formatted with its own type, or as null when absent. */
    interpolationHole(node, format, alignment) {
      if (!isLiftedAccess(node)) return super.interpolationHole(node, format, alignment);
      const access = this.liftedAccess(node),
        present = this.formattedValue(access.value(), format, alignment),
        absent = this.formattedValue(n.nullLiteral('object'), format, alignment);
      return n.sequence(access.locals, access.effects, n.conditional(access.absent(), absent, present, 'string'));
    }
    boxedOrNull(node) {
      // A primitive in an `object` slot is its own box on both back ends (see `box` in translate-expressions.js).
      const access = this.liftedAccess(node);
      if (!boxedTypes.has(access.value().legacyType)) return this.unsupported('nullable value types', node.syntax);
      // The null and the primitive must not meet on the evaluation stack: `choose` stores each through an object slot.
      const boxed = this.choose(n.not(access.absent()), access.value(), n.nullLiteral('object'), 'object');
      return n.sequence(access.locals, access.effects, boxed);
    }
  };
