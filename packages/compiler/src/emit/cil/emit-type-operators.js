/**
 * Operators over types (SF-A02-T30): `typeof` and `sizeof` of a type known only at run time.
 */

/** Class mixin: `typeof`, `sizeof`. */
export const TypeOperatorEmission = Base =>
  class extends Base {
    /** `typeof(T)` is `Type.GetTypeFromHandle(ldtoken T)`. */
    exprTypeOf(node) {
      const type = this.core.type,
        handle = this.core.bridge.coreType('System_RuntimeTypeHandle'),
        shape = { isStatic: true, returnType: type, parameters: [{ type: handle }] };
      this.il.emit('ldtoken', this.tokens.type(node.operandType));
      return this.il.emit('call', this.tokens.external(type, 'GetTypeFromHandle', shape), { pops: 1, pushes: 1 });
    }
    exprSizeOf(node) {
      const type = node.operandType ?? node.sizeType;
      if (!type) return this.unsupported('sizeof', node.syntax);
      return this.il.emit('sizeof', this.tokens.type(type));
    }
  };
