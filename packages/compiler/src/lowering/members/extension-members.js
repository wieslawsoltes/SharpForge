/**
 * Code generation for C# 14 extension properties (SF-A02-T83).
 *
 * The accessors of an extension property are static methods of the declaring class that take the receiver as their
 * first parameter (symbols/source/extension-blocks.js). In the image a call passes the receiver of an instance
 * method as its first argument, so `receiver.P` reads through `get_P` and writes through `set_P` exactly like an
 * instance property whose accessors happen to be those static methods: no new node and no new instruction.
 * Extension methods and static extension members are ordinary static calls and need nothing here.
 */

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
