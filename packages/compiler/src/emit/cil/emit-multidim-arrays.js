/**
 * Multi-dimensional arrays (SF-A02-T30). An array of rank two or more has no element instructions of its own: the
 * runtime gives every array type the methods (ECMA-335 II.14.2)
 *
 *   .ctor(int32, ..)             one length per dimension
 *   T Get(int32, ..)             void Set(int32, .., T)             T& Address(int32, ..)
 *
 * and `Length`, `Rank` and `GetLength(d)` are those of `System.Array`. `foreach` visits the elements in row-major
 * order with one loop per dimension.
 */
import { RefKind } from '../../symbols/types.js';

/** An element of a multi-dimensional array; the protocol of locations.js. */
class MultiDimensionalElementLocation {
  /** @param array, indices bound nodes  @param type the element type */
  constructor(emitter, array, indices, type) {
    this.emitter = emitter;
    this.type = type;
    this.arrayType = array.type;
    this.array = array;
    this.indices = indices;
    this.slots = null;
  }
  /** Evaluates the array and the indices into temporaries, once. */
  capture() {
    if (this.slots) return;
    const emitter = this.emitter,
      operands = [this.array, ...this.indices];
    this.slots = operands.map(operand => {
      const slot = emitter.temp(operand.type);
      emitter.expression(operand);
      emitter.il.emit('stloc', slot);
      return slot;
    });
  }
  pushOperands() {
    if (this.slots) return this.slots.forEach(slot => this.emitter.il.emit('ldloc', slot));
    this.emitter.expression(this.array);
    for (const index of this.indices) this.emitter.expression(index);
    return undefined;
  }
  load() {
    this.pushOperands();
    this.emitter.arrayElementCall(this.arrayType, 'Get');
  }
  beginStore() {
    this.pushOperands();
  }
  endStore() {
    this.emitter.arrayElementCall(this.arrayType, 'Set');
  }
  address() {
    this.pushOperands();
    this.emitter.arrayElementCall(this.arrayType, 'Address');
  }
}

/** The lengths of the dimensions an initializer implies: `{ {1, 2}, {3, 4}, {5, 6} }` is 3 by 2. */
function initializerLengths(elements, rank) {
  const lengths = [];
  for (let level = elements, dimension = 0; dimension < rank; dimension++) {
    lengths.push(Array.isArray(level) ? level.length : 0);
    level = Array.isArray(level) ? level[0] : null;
  }
  return lengths;
}

/** Class mixin: arrays of rank two or more. */
export const MultiDimensionalArrayEmission = Base =>
  class extends Base {
    /** Calls `Get`, `Set`, `Address` or `.ctor` of an array type; the operands are on the stack. */
    arrayElementCall(arrayType, name) {
      const rank = arrayType.rank,
        element = arrayType.elementType,
        integers = Array.from({ length: rank }, () => ({ type: this.core.int })),
        shapes = {
          Get: { returnType: element, parameters: integers, effect: { pops: rank + 1, pushes: 1 } },
          Set: { returnType: this.core.void, parameters: [...integers, { type: element }], effect: { pops: rank + 2, pushes: 0 } },
          Address: { returnType: element, refKind: RefKind.Ref, parameters: integers, effect: { pops: rank + 1, pushes: 1 } },
          '.ctor': { returnType: this.core.void, parameters: integers, effect: { pops: rank, pushes: 1 } },
        },
        { effect, ...shape } = shapes[name],
        token = this.tokens.external(arrayType, name, { isStatic: false, ...shape });
      return this.il.emit(name === '.ctor' ? 'newobj' : 'call', token, effect);
    }
    /**
     * Calls an instance member of `System.Array` on the array on the stack (the arguments are on the stack too).
     * @param {object[]} parameterTypes the parameter types  @param returnType the return type
     */
    arrayMember(name, parameterTypes, returnType) {
      const shape = { isStatic: false, returnType, parameters: parameterTypes.map(type => ({ type })) },
        token = this.tokens.external(this.core.array, name, shape);
      return this.il.emit('callvirt', token, { pops: parameterTypes.length + 1, pushes: 1 });
    }
    location(node) {
      if (node.kind !== 'ArrayAccess' || node.indices.length === 1) return super.location(node);
      return new MultiDimensionalElementLocation(this, node.array, node.indices, node.type);
    }
    exprArrayAccess(node) {
      if (node.indices.length === 1) return super.exprArrayAccess(node);
      this.location(node).load();
      return undefined;
    }
    exprArrayCreation(node) {
      const type = node.type,
        rank = type.rank;
      if (rank === 1) return super.exprArrayCreation(node);
      const il = this.il,
        lengths = node.elements ? initializerLengths(node.elements, rank) : null;
      // With an initializer the lengths are those of the initializer (the written sizes are constants equal to them).
      if (lengths) for (const length of lengths) il.emit('ldc.i4', length);
      else if (node.sizes?.length === rank) for (const size of node.sizes) this.expression(size);
      else return this.unsupported('this array creation form', node.syntax);
      this.arrayElementCall(type, '.ctor');
      if (node.elements) this.multiDimensionalInitializer(type, node.elements, []);
      return undefined;
    }
    /** Stores each element of a nested initializer; the array is on the stack and stays there. */
    multiDimensionalInitializer(type, elements, position) {
      elements.forEach((element, index) => {
        const indices = [...position, index];
        if (Array.isArray(element)) return this.multiDimensionalInitializer(type, element, indices);
        this.il.emit('dup');
        for (const value of indices) this.il.emit('ldc.i4', value);
        this.expression(element);
        return this.arrayElementCall(type, 'Set');
      });
    }
    exprArrayLength(node) {
      const array = node.operand ?? node.array ?? node.receiver,
        isVector = array.type?.rank === 1;
      if (isVector && node.member !== 'Rank') return super.exprArrayLength(node);
      this.expression(array);
      if (node.member === 'Rank') return this.arrayMember('get_Rank', [], this.core.int);
      if (node.member === 'LongLength') return this.arrayMember('get_LongLength', [], this.core.long);
      return this.arrayMember('get_Length', [], this.core.int);
    }
    /** `foreach` over a multi-dimensional array: one loop per dimension, the last one innermost. */
    forEachArray(node) {
      const arrayType = node.collection.type,
        rank = arrayType.rank;
      if (rank === 1) return super.forEachArray(node);
      const il = this.il,
        int = this.core.int,
        array = this.temp(arrayType),
        dimensions = Array.from({ length: rank }, () => ({
          index: this.temp(int),
          limit: this.temp(int),
          body: il.newLabel(),
          step: il.newLabel(),
          test: il.newLabel(),
        })),
        end = il.newLabel(),
        innermost = dimensions[rank - 1];
      this.expression(node.collection);
      il.emit('stloc', array);
      dimensions.forEach((dimension, position) => {
        il.emit('ldloc', array).emit('ldc.i4', position);
        this.arrayMember('GetLength', [int], int);
        il.emit('stloc', dimension.limit);
      });
      for (const dimension of dimensions) {
        il.emit('ldc.i4', 0).emit('stloc', dimension.index).emit('br', dimension.test);
        il.mark(dimension.body, 0);
      }
      il.emit('ldloc', array);
      for (const dimension of dimensions) il.emit('ldloc', dimension.index);
      this.arrayElementCall(arrayType, 'Get');
      this.iterationValue(node, arrayType.elementType);
      this.withJumpTargets({ breakLabel: end, continueLabel: innermost.step }, () => this.statement(node.body));
      for (const dimension of [...dimensions].reverse()) {
        il.mark(dimension.step);
        il.emit('ldloc', dimension.index).emit('ldc.i4', 1).emit('add').emit('stloc', dimension.index);
        il.mark(dimension.test);
        il.emit('ldloc', dimension.index).emit('ldloc', dimension.limit).emit('blt', dimension.body);
      }
      il.mark(end);
      return undefined;
    }
  };
