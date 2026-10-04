/**
 * Constants (SF-A02-T30): folded constant values, `null`, and the default value of a type.
 */
import { TypeKind } from '../../symbols/types.js';
import { isReference, primitiveOf } from './type-facts.js';

const int32Constants = new Set(['bool', 'char', 'sbyte', 'byte', 'short', 'ushort', 'int', 'uint']);

/** Class mixin: constants. */
export const ConstantEmission = Base =>
  class extends Base {
    /** Emits the folded constant of a node; returns false when it has none. */
    constant(node) {
      const value = node.constantValue;
      if (!value || node.kind === 'Lambda') return false;
      if (value.isNull) this.defaultValue(node.type);
      else this.constantValue(value, node.syntax);
      return true;
    }
    /** Pushes a non-null compiler constant. */
    constantValue(value, syntax = null) {
      const il = this.il;
      if (int32Constants.has(value.type)) il.emit('ldc.i4', Number(value.value) | 0);
      else if (value.type === 'long' || value.type === 'ulong') il.emit('ldc.i8', BigInt.asIntN(64, BigInt(value.value)));
      else if (value.type === 'float') il.emit('ldc.r4', value.value);
      else if (value.type === 'double') il.emit('ldc.r8', value.value);
      else if (value.type === 'string') il.emit('ldstr', this.tokens.string(value.value));
      else this.unsupported(`a constant of type '${value.type}'`, syntax);
    }
    exprLiteral(node) {
      if (node.literal === 'null' || node.literal === 'default') return this.defaultValue(node.type);
      return this.unsupported('a literal without a constant value', node.syntax);
    }
    exprDefault(node) {
      this.defaultValue(node.type);
    }
    /** Pushes the default value of a type: null, zero, or a zero-initialized struct. */
    defaultValue(type) {
      const il = this.il,
        primitive = primitiveOf(type);
      if (primitive) {
        if (primitive.stack === 'i8') il.emit('ldc.i8', 0n);
        else if (primitive.stack === 'r') il.emit(primitive.bits === 32 ? 'ldc.r4' : 'ldc.r8', 0);
        else {
          il.emit('ldc.i4', 0);
          if (primitive.stack === 'i') il.emit('conv.i');
        }
      } else if (!type || (isReference(type) && type.typeKind !== TypeKind.TypeParameter)) il.emit('ldnull');
      else {
        const slot = this.temp(type);
        il.emit('ldloca', slot).emit('initobj', this.tokens.type(type)).emit('ldloc', slot);
      }
    }
  };
