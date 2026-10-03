/**
 * Lowering of throw expressions (SF-A02-T64): `c ? v : throw e`, `v ?? throw e`, `=> throw e`.
 *
 * The IR has a throw statement and sequences. A throw expression becomes a sequence whose side effect throws; its
 * value is never produced, so a default of the type the context expects stands in for it. Where no value is
 * expected (the body of a void member or of an `Action` lambda) the sequence yields a null reference that the
 * caller discards.
 */
import { n } from '../codegen/semantic/node-factory.js';

/** Class mixin for the body translator: throw expressions. */
export const ThrowExpressionLowering = Base =>
  class extends Base {
    /** `throw operand` as an expression of the image type `type`. */
    throwing(node, type) {
      const thrown = n.throwStatement(this.expression(node.operand), this.span(node.syntax));
      return n.sequence([], [thrown], type ? this.defaultValue(type) : n.nullLiteral('object'));
    }
    exprThrow(node) {
      return this.throwing(node, null);
    }
    exprConversion(node) {
      if (node.conversion?.kind !== 'ImplicitThrow') return super.exprConversion(node);
      return this.throwing(node.operand, this.imageType(node.type, node.syntax));
    }
  };
