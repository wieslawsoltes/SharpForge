/**
 * Anonymous types in method bodies (SF-A02-T30): `new { Name = value, other.Member }` constructs the generic class
 * that declares the type (anonymous-type-members.js) over the member types, and a member read calls its getter.
 * `Equals`, `GetHashCode` and `ToString` are the class's overrides, reached by the virtual calls the binder bound.
 * `with` on an anonymous type constructs a new instance (records/emit-records.js sends it here).
 */
import { SymbolKind } from '../../symbols/types.js';
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
    /**
     * `value with { Name = x }` over an anonymous type (C# 10): a new instance whose members are the written values
     * and, for the others, those of the receiver. The receiver and then the values are evaluated in source order.
     */
    anonymousWith(node) {
      const il = this.il,
        type = node.type,
        receiver = this.temp(type),
        written = new Map();
      this.expression(node.receiver);
      il.emit('stloc', receiver);
      for (const initializer of node.initializers ?? []) {
        const property = initializer.target?.property;
        if (!property || !initializer.value) return this.unsupported("this initializer of 'with' on an anonymous type", node.syntax);
        const slot = this.temp(property.type);
        this.expression(initializer.value);
        il.emit('stloc', slot);
        written.set(property.name, slot);
      }
      const properties = type.getMembers().filter(member => member.kind === SymbolKind.Property);
      for (const property of properties) {
        if (written.has(property.name)) il.emit('ldloc', written.get(property.name));
        else il.emit('ldloc', receiver).emit('callvirt', anonymousMemberToken(this.tokens, type, 'get_' + property.name), { pops: 1, pushes: 1 });
      }
      return il.emit('newobj', anonymousMemberToken(this.tokens, type, '.ctor'), { pops: properties.length, pushes: 1 });
    }
    callAccessor(method, receiverNode, constrainedTo) {
      const owner = method?.containingType;
      if (!owner?.isAnonymousType) return super.callAccessor(method, receiverNode, constrainedTo);
      return this.il.emit('callvirt', anonymousMemberToken(this.tokens, owner, method.name), { pops: 1, pushes: 1 });
    }
  };
