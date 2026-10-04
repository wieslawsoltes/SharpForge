/**
 * Anonymous types in method bodies (SF-A02-T30): `new { Name = value, other.Member }` constructs the generic class
 * that declares the type (anonymous-type-members.js) over the member types, and a member read calls its getter.
 * `Equals`, `GetHashCode` and `ToString` are the class's overrides, reached by the virtual calls the binder bound.
 */
import { anonymousMemberToken } from './anonymous-type-members.js';

/** Class mixin: anonymous types. */
export const AnonymousTypeEmission = Base =>
  class extends Base {
    /** The values in source order, which is their evaluation order, then the constructor of the construction. */
    exprAnonymousObjectCreation(node) {
      const type = node.type,
        initializers = node.initializers;
      for (const { value } of initializers) this.expression(value);
      return this.il.emit('newobj', anonymousMemberToken(this.tokens, type, '.ctor'), { pops: initializers.length, pushes: 1 });
    }
    callAccessor(method, receiverNode, constrainedTo) {
      const owner = method?.containingType;
      if (!owner?.isAnonymousType) return super.callAccessor(method, receiverNode, constrainedTo);
      return this.il.emit('callvirt', anonymousMemberToken(this.tokens, owner, method.name), { pops: 1, pushes: 1 });
    }
  };
