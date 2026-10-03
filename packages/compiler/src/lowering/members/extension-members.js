/**
 * Code generation for C# 14 extension properties (SF-A02-T83).
 *
 * The accessors of an extension property are static methods of the declaring class that take the receiver as their
 * first parameter (symbols/source/extension-blocks.js). In the image a call passes the receiver of an instance
 * method as its first argument, so `receiver.P` reads through `get_P` and writes through `set_P` exactly like an
 * instance property whose accessors happen to be those static methods: no new node and no new instruction.
 * Extension methods and static extension members are ordinary static calls and need nothing here.
 *
 * An extension indexer (C# 15 preview, SF-A02-T91; provisional: csharplang/proposals/csharp-15.0/extension-indexers.md
 * revision 1, "the indexer access is then processed as a static method invocation ... the receiver as the first
 * argument") is the call of its static `get_Item` or `set_Item` implementation.
 */
import { n } from '../../codegen/semantic/node-factory.js';
import { RefKind } from '../../symbols/types.js';

/** Generator mixin: the accessors of an extension property in the shape the IR emitter reads and writes through. */
export const ExtensionMemberGeneration = Base =>
  class extends Base {
    propertyOf(symbol, syntax) {
      if (!symbol.isExtensionProperty) return super.propertyOf(symbol, syntax);
      const receiverType = symbol.isStatic ? null : symbol.extensionReceiverType;
      return {
        isStatic: symbol.isStatic,
        // `owner` types the temporary that holds the receiver of a compound assignment: the extended type, not the class.
        owner: receiverType ? { name: this.types.imageType(receiverType, syntax) } : this.classOf(symbol.containingType, syntax),
        get: symbol.getMethod ? this.methodOf(symbol.getMethod, syntax) : null,
        set: symbol.setMethod ? this.methodOf(symbol.setMethod, syntax) : null,
      };
    }
  };

/** Translator mixin: reads and writes through an extension indexer. */
export const ExtensionIndexerLowering = Base =>
  class extends Base {
    /** The receiver and the indexer arguments of an extension indexer access, as the arguments of its accessor. */
    extensionIndexerArguments(node, accessor) {
      const byReference = accessor.parameters[0].refKind && accessor.parameters[0].refKind !== RefKind.None;
      if (byReference) this.unsupported('extension indexers with a by-reference receiver', node.syntax);
      return [this.expression(node.receiver), ...this.arguments(node, node.property)];
    }
    exprIndexerAccess(node) {
      const getter = node.property.isExtensionIndexer ? node.property.getMethod : null;
      if (!getter) return super.exprIndexerAccess(node);
      return n.call(this.g.methodOf(getter, node.syntax), null, this.extensionIndexerArguments(node, getter));
    }
    sourceIndexerStore(node, value) {
      if (!node.property.isExtensionIndexer) return super.sourceIndexerStore(node, value);
      const setter = node.property.setMethod;
      if (!setter) return this.unsupported('assignment to a read-only indexer', node.syntax);
      const stored = this.temp(value.legacyType, 'value'),
        store = n.call(this.g.methodOf(setter, node.syntax), null, [...this.extensionIndexerArguments(node, setter), n.local(stored)]);
      return n.sequence([stored], [n.assign(n.local(stored), value), store], n.local(stored));
    }
  };
