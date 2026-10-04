/**
 * Bodies the language defines for members written without one (SF-A02-T30): the accessors of an auto-property read
 * and write its backing field.
 */
import { MethodKind } from '../../symbols/members.js';

/** Class mixin: synthesized member bodies. */
export const AccessorEmission = Base =>
  class extends Base {
    /**
     * Emits the body of a method symbol that has no bound body.
     * @returns the instruction stream, or null when the language defines no body for the symbol
     */
    synthesizedBody(method) {
      const property = method.associatedSymbol,
        field = property?.backingField,
        isGetter = method.methodKind === MethodKind.PropertyGet;
      if (!field || (!isGetter && method.methodKind !== MethodKind.PropertySet)) return null;
      const il = this.il,
        token = this.tokens.field(field);
      if (!method.isStatic) il.emit('ldarg', 0);
      if (isGetter) {
        il.emit(method.isStatic ? 'ldsfld' : 'ldfld', token);
        il.emit('ret', undefined, { pops: 1, pushes: 0 });
        return il;
      }
      il.emit('ldarg', method.isStatic ? 0 : 1);
      il.emit(method.isStatic ? 'stsfld' : 'stfld', token);
      il.emit('ret', undefined, { pops: 0, pushes: 0 });
      return il;
    }
  };
