/**
 * Operators over types (SF-A02-T30): `typeof` and `sizeof` of a type known only at run time.
 */

/** True when a type syntax leaves type arguments out (`Dictionary<,>`, `Outer<>.Inner`). */
function hasOmittedTypeArgument(syntax) {
  if (syntax.kind === 'OmittedTypeArgument') return true;
  for (const child of syntax.childNodes?.() ?? []) if (hasOmittedTypeArgument(child)) return true;
  return false;
}

/** Class mixin: `typeof`, `sizeof`. */
export const TypeOperatorEmission = Base =>
  class extends Base {
    /** `typeof(T)` is `Type.GetTypeFromHandle(ldtoken T)`. */
    exprTypeOf(node) {
      const type = this.core.type,
        handle = this.core.bridge.coreType('System_RuntimeTypeHandle'),
        shape = { isStatic: true, returnType: type, parameters: [{ type: handle }] };
      // `typeof(Dictionary<,>)` names the generic type definition itself, not its instantiation over its own parameters.
      const isUnbound = node.syntax?.type && hasOmittedTypeArgument(node.syntax.type),
        token = isUnbound ? this.tokens.types.definitionToken(node.operandType) : this.tokens.type(node.operandType);
      this.il.emit('ldtoken', token);
      return this.il.emit('call', this.tokens.external(type, 'GetTypeFromHandle', shape), { pops: 1, pushes: 1 });
    }
    exprSizeOf(node) {
      const type = node.operandType ?? node.sizeType;
      if (!type) return this.unsupported('sizeof', node.syntax);
      return this.il.emit('sizeof', this.tokens.type(type));
    }
  };
