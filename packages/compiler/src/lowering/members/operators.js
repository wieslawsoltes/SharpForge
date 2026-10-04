/**
 * Lowering of user-defined operators where an operator call is combined with a store or a test, and of compound
 * assignment and increment on user-defined indexers (SF-A02-T06.5, SF-A02-T10.2):
 *
 *   x op= y         ->  x = op(x, y)                      operands of x evaluated once
 *   ++x, x++        ->  x = op(x)                         the value is the new one (prefix) or the old one (postfix)
 *   a[i] op= y      ->  $t = a; $i = i; $t.set($i, $t.get($i) op y)
 *   x && y, x || y  ->  T.false(x) ? x : T.&(x, y)        x evaluated once, y only when needed
 *   if (x)          ->  T.true(x)
 *
 * Operators are static methods of the image, so every one of these is a call the IR already has.
 */
import { TypeKind } from '../../symbols/types.js';
import {scalarStep} from '../../codegen/semantic/scalar-step.js';
import {isTupleElement} from '../tuples/locations.js';
import { n } from '../../codegen/semantic/node-factory.js';

/** `expression` with the node `original` replaced by `replacement`, through the conversions applied to it. */
export function substitute(expression, original, replacement) {
  if (expression === original) return replacement;
  if (expression?.kind === 'Conversion') return { ...expression, operand: substitute(expression.operand, original, replacement) };
  return expression;
}

/** Class mixin for the body translator: operator calls that read and write their operand. */
export const OperatorLowering = Base =>
  class extends Base {
    /** True when the emitter's own read-modify-write of the target cannot be used. */
    needsExplicitStore(node, target) {
      return !isTupleElement(target) && (!!node.method || (target.kind === 'IndexerAccess' && this.g.isSource(target.property)));
    }
    /** `a[i] = v` on a user-defined indexer: the receiver and the index arguments are evaluated before the value. */
    exprAssignment(node) {
      const left = node.left;
      if (left.kind !== 'IndexerAccess' || !this.g.isSource(left.property)) return super.exprAssignment(node);
      const sink = { locals: [], effects: [] },
        target = this.spillOperands(left, sink);
      return n.sequence(sink.locals, sink.effects, this.storeIntoTarget(target, this.expression(node.right)));
    }
    exprCompoundAssignment(node) {
      const left = node.left;
      if (left.type?.typeKind === TypeKind.Delegate || !this.needsExplicitStore(node, left)) return super.exprCompoundAssignment(node);
      const sink = { locals: [], effects: [] },
        target = this.spillOperands(left, sink),
        current = this.lowered(left, () => this.expression(target)),
        operation = node.operation;
      if (!operation) return this.unsupported('this compound assignment', node.syntax);
      const computed = this.expression({ ...operation, left: substitute(operation.left, left, current) }),
        value = this.convertBack(computed, left, node);
      return n.sequence(sink.locals, sink.effects, this.storeIntoTarget(target, value));
    }
    /** The result of the operator converted to the type of the target (`double d; d += 1` computes in double). */
    convertBack(value, target, node) {
      const type = this.imageType(target.type, node.syntax);
      if (value.legacyType === type) return value;
      if (node.method) return this.unsupported('a compound assignment whose operator result needs a conversion', node.syntax);
      return n.convert(value, type, !!node.isChecked);
    }
    exprIncrement(node) {
      const operand = node.operand;
      if (!this.needsExplicitStore(node, operand)) return super.exprIncrement(node);
      const sink = { locals: [], effects: [] },
        target = this.spillOperands(operand, sink),
        type = this.imageType(operand.type, node.syntax),
        step = value => this.stepped(node, value, type);
      if (!node.isPostfix) return n.sequence(sink.locals, sink.effects, this.storeIntoTarget(target, step(this.expression(target))));
      const old = this.temp(type, 'old');
      sink.locals.push(old);
      sink.effects.push(n.assign(n.local(old), this.expression(target)), this.storeIntoTarget(target, step(n.local(old))));
      return n.sequence(sink.locals, sink.effects, n.local(old));
    }
    /** The incremented or decremented value: the user-defined operator, or `value + 1` / `value - 1`. */
    stepped(node, value, type) {
      const scalar = scalarStep(node, value, type);
      if (scalar) return scalar;
      if (node.method) {
        const result = n.call(this.g.methodOf(node.method, node.syntax), null, [value]);
        return result.legacyType === type ? result : this.unsupported('an increment whose operator result needs a conversion', node.syntax);
      }
      if (type !== 'int' && type !== 'double') return this.unsupported(`increment of '${type}'`, node.syntax);
      return n.binary(node.operator === '++' ? '+' : '-', value, n.literal(1, type), type, !!node.isChecked);
    }
    exprBinary(node) {
      if (!node.method || !node.isLogical) return super.exprBinary(node);
      const test = node.shortCircuit;
      if (!test) return this.unsupported('user-defined conditional logical operators', node.syntax);
      // `x && y` is `T.false(x) ? x : T.&(x, y)`; `x || y` is `T.true(x) ? x : T.|(x, y)`.
      const left = this.once(this.expression(node.left), 'left'),
        decided = n.call(this.g.methodOf(test, node.syntax), null, [left.read()]),
        combined = n.call(this.g.methodOf(node.method, node.syntax), null, [left.read(), this.expression(node.right)]);
      return n.sequence(left.locals, left.effects, n.conditional(decided, left.read(), combined, combined.legacyType));
    }
    /** A condition of a type with `operator true`. */
    exprUserDefinedCondition(node) {
      return n.call(this.g.methodOf(node.method, node.syntax), null, [this.expression(node.operand)]);
    }
  };
