/**
 * Arrays (SF-A02-T30): one-dimensional (SZ) array creation with and without initializers, element reads and writes
 * with the typed instructions of the element type, `Length`, and `foreach` over an array.
 */
import { ElementLocation } from './locations.js';
import { isReference, primitiveOf } from './type-facts.js';

/** Class mixin: arrays. */
export const ArrayEmission = Base =>
  class extends Base {
    exprArrayCreation(node) {
      const il = this.il,
        elementType = node.type.elementType;
      if (node.type.rank !== 1) return this.unsupported('multi-dimensional arrays', node.syntax);
      if (!node.elements) {
        if (node.sizes?.length !== 1) return this.unsupported('this array creation form', node.syntax);
        this.expression(node.sizes[0]);
        return il.emit('newarr', this.tokens.type(elementType));
      }
      il.emit('ldc.i4', node.elements.length).emit('newarr', this.tokens.type(elementType));
      node.elements.forEach((element, index) => {
        if (element.kind === 'ArrayInitializer' || Array.isArray(element)) return this.unsupported('nested array initializers', node.syntax);
        il.emit('dup').emit('ldc.i4', index);
        this.expression(element);
        return this.storeElement(elementType);
      });
      return undefined;
    }
    exprArrayAccess(node) {
      if (node.indices.length !== 1) return this.unsupported('multi-dimensional arrays', node.syntax);
      new ElementLocation(this, node.array, node.indices[0], node.type).load();
      return undefined;
    }
    exprArrayLength(node) {
      const array = node.operand ?? node.array ?? node.receiver;
      if (node.member === 'Rank') return this.unsupported('Array.Rank', node.syntax);
      this.expression(array);
      this.il.emit('ldlen');
      return this.il.emit(node.member === 'LongLength' ? 'conv.i8' : 'conv.i4');
    }
    /** Replaces the array and index on the stack by the element. */
    loadElement(type) {
      const primitive = primitiveOf(type);
      if (primitive) this.il.emit('ldelem.' + (primitive.load ?? primitive.suffix));
      else if (isReference(type)) this.il.emit('ldelem.ref');
      else this.il.emit('ldelem', this.tokens.type(type));
    }
    /** Stores the value on the stack into the array element named by the array and index below it. */
    storeElement(type) {
      const primitive = primitiveOf(type);
      if (primitive) this.il.emit('stelem.' + primitive.store);
      else if (isReference(type)) this.il.emit('stelem.ref');
      else this.il.emit('stelem', this.tokens.type(type));
    }
    /** `foreach` over an array indexes a copy of the reference, so reassigning the variable does not change the loop. */
    forEachArray(node) {
      const il = this.il,
        arrayType = node.collection.type,
        array = this.temp(arrayType),
        index = this.temp(this.core.int),
        test = il.newLabel(),
        body = il.newLabel(),
        step = il.newLabel(),
        end = il.newLabel();
      this.expression(node.collection);
      il.emit('stloc', array).emit('ldc.i4', 0).emit('stloc', index).emit('br', test);
      il.mark(body, 0);
      il.emit('ldloc', array).emit('ldloc', index);
      this.loadElement(arrayType.elementType);
      this.iterationValue(node, arrayType.elementType);
      this.withJumpTargets({ breakLabel: end, continueLabel: step }, () => this.statement(node.body));
      il.mark(step);
      il.emit('ldloc', index).emit('ldc.i4', 1).emit('add').emit('stloc', index);
      il.mark(test);
      il.emit('ldloc', index).emit('ldloc', array).emit('ldlen').emit('conv.i4').emit('blt', body);
      il.mark(end);
    }
  };
