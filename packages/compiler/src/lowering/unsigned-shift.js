/**
 * Unsigned right shift (C# 11, SF-A02-T76). The image has the arithmetic shift only, so `x >>> n` on an `int` is
 * the arithmetic shift with the bits the sign filled in cleared:
 *
 *   count = n & 31;  count == 0 ? x : (x >> count) & (int.MaxValue >> (count - 1))
 *
 * Both operands are evaluated once, left first. `x >>>= n` goes through the explicit store of the member lowerings,
 * which computes `x >>> n` with this lowering. Other operand types need unsigned or 64-bit integers, which the
 * runtime does not have; a user-defined `operator >>>` is an ordinary call.
 */
import { n } from '../codegen/semantic/node-factory.js';

const isUnsignedShift = node => node.operator === '>>>' && !node.method && !node.isLifted;

/** Translator mixin: `>>>` on `int`. */
export const UnsignedShiftLowering = Base =>
  class extends Base {
    exprBinary(node) {
      if (!isUnsignedShift(node)) return super.exprBinary(node);
      const type = this.imageType(node.type, node.syntax);
      if (type !== 'int') return this.unsupported(`the unsigned right shift operator on '${node.type.toDisplayString()}'`, node.syntax);
      const value = this.holder('int', 'shifted'),
        count = this.holder('int', 'count'),
        int = literal => n.literal(literal, 'int');
      const masked = n.binary('&', this.expression(node.right), int(31), 'int'),
        mask = n.binary('>>', int(2147483647), n.binary('-', count.read(), int(1), 'int'), 'int'),
        shifted = n.binary('&', n.binary('>>', value.read(), count.read(), 'int'), mask, 'int');
      return n.sequence(
        [],
        [value.init(this.expression(node.left)), count.init(masked)],
        n.conditional(n.equals(count.read(), int(0)), value.read(), shifted, 'int'),
      );
    }
    /** `x >>>= n` has no instruction of its own: it is stored explicitly as `x = x >>> n`. */
    needsExplicitStore(node, target) {
      return (node.kind === 'CompoundAssignment' && isUnsignedShift(node)) || super.needsExplicitStore(node, target);
    }
  };
