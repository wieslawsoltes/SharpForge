/**
 * Lowering of record expressions (SF-A02-T08.6, T08.7): calls of the `object` members a record overrides, and
 * `with` expressions.
 */
import { SymbolKind } from '../../symbols/types.js';
import { n } from '../../codegen/semantic/node-factory.js';

/** Class mixin: records. */
export const RecordTranslation = Base =>
  class extends Base {
    /**
     * `record.ToString()` and `record.GetHashCode()` bind to the virtual methods of `object`. Nothing derives from a
     * record in a generated image, so the record's own override is the method that runs.
     */
    exprCall(node) {
      const method = node.method,
        receiver = node.receiver;
      const isObjectMember = !method.parameters.length && !method.isStatic && !this.g.isSource(method);
      if (!isObjectMember || !receiver || receiver.kind === 'Base' || !this.g.records.handles(receiver.type)) return super.exprCall(node);
      const own = receiver.type
        .getMembers(method.name)
        .find(member => member.kind === SymbolKind.Method && !member.parameters.length && member.isOverride);
      return own ? n.call(this.g.methodOf(own, node.syntax), this.expression(receiver), []) : super.exprCall(node);
    }
    /** The receiver is copied field by field, then the listed members are assigned as an object initializer assigns them. */
    exprWith(node) {
      if (!this.g.records.handles(node.type)) return this.unsupported('with on a struct value', node.syntax);
      const copy = this.g.records.clone(node.type, this.expression(node.receiver), node.syntax);
      return node.initializers.length ? this.withInitializers(node, copy) : copy;
    }
  };
