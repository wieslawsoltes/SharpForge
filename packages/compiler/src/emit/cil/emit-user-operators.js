/**
 * User-defined operators beyond a plain call (SF-A02-T30):
 *
 *   x && y     `T.false(x) ? x : T.&(x, y)`; `x || y` is `T.true(x) ? x : T.|(x, y)` - `x` is evaluated once and `y`
 *              only when `x` does not decide (C# 12.14.3)
 *   if (x)     a condition of a type with `operator true` is `T.true(x)`
 *   new T()    of a type parameter is `Activator.CreateInstance<T>()`
 */
import { TypeKind } from '../../symbols/types.js';
import { frameworkType, methodTypeParameter } from './framework-types.js';

/** Class mixin: user-defined conditional logical operators, conditions, and creation of a type parameter. */
export const UserOperatorEmission = Base =>
  class extends Base {
    exprBinary(node) {
      if (!node.method || !node.isLogical) return super.exprBinary(node);
      const test = node.shortCircuit;
      if (!test) return this.unsupported('user-defined conditional logical operators', node.syntax);
      const il = this.il,
        left = this.temp(node.left.type),
        decided = il.newLabel(),
        end = il.newLabel();
      this.expression(node.left);
      il.emit('stloc', left).emit('ldloc', left);
      this.callMethod(test, { syntax: node.syntax });
      il.emit('brtrue', decided);
      il.emit('ldloc', left);
      this.expression(node.right);
      this.callMethod(node.method, { syntax: node.syntax });
      il.emit('br', end);
      il.mark(decided);
      il.emit('ldloc', left);
      il.mark(end);
      return undefined;
    }
    exprUserDefinedCondition(node) {
      this.expression(node.operand);
      return this.callMethod(node.method, { syntax: node.syntax });
    }
    exprObjectCreation(node) {
      if (node.type.typeKind !== TypeKind.TypeParameter) return super.exprObjectCreation(node);
      const activator = frameworkType(this.core, 'System', 'Activator'),
        shape = { isStatic: true, arity: 1, returnType: methodTypeParameter(0), parameters: [] };
      this.il.emit('call', this.tokens.externalGeneric(activator, 'CreateInstance', shape, [node.type]), { pops: 0, pushes: 1 });
      if (node.initializers?.length || node.collectionInitializers?.length) this.objectInitializers(node);
      return undefined;
    }
  };
