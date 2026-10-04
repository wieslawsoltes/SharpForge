/**
 * `System.Index` and `System.Range` as values (SF-A02-T30), and the accesses that need them at run time:
 *
 *   ^n               new Index(n, fromEnd: true)
 *   a..b, ..b, a..   new Range(a, b); an omitted bound is `Index.Start` (0) or `Index.End` (^0)
 *   array[range]     RuntimeHelpers.GetSubArray<T>(array, range), which also checks the range
 *   x[index]         an `Index` that is not written as `^n` or an `int`: `index.GetOffset(length)`
 *   x[range]         a `Range` that is not written as `a..b`: the offsets of its `Start` and `End`
 *
 * The forms written with constants or `int` operands keep the arithmetic of emit-index-range.js.
 */
import { ArrayTypeSymbol } from '../../symbols/types.js';
import { frameworkType, methodTypeParameter } from './framework-types.js';

const isInt = type => type?.specialType === 'System_Int32';
/** True for an operand whose offset emit-index-range.js computes without an `Index` value. */
const isPlainBound = node => !node || node.kind === 'FromEndIndex' || isInt(node.type) || (node.kind === 'Conversion' && isInt(node.operand?.type));

/** Class mixin: Index and Range values. */
export const IndexValueEmission = Base =>
  class extends Base {
    get indexType() {
      return this.core.bridge.coreType('System_Index');
    }
    get rangeType() {
      return this.core.bridge.coreType('System_Range');
    }
    /** `new Index(value, fromEnd)` over the `int` on the stack. */
    newIndex(isFromEnd) {
      const core = this.core,
        shape = { isStatic: false, returnType: core.void, parameters: [{ type: core.int }, { type: core.bool }] };
      this.il.emit('ldc.i4', isFromEnd ? 1 : 0);
      return this.il.emit('newobj', this.tokens.external(this.indexType, '.ctor', shape), { pops: 2, pushes: 1 });
    }
    exprFromEndIndex(node) {
      this.expression(node.operand);
      return this.newIndex(true);
    }
    exprRange(node) {
      const index = this.indexType,
        shape = { isStatic: false, returnType: this.core.void, parameters: [{ type: index }, { type: index }] };
      for (const [bound, isEnd] of [
        [node.left, false],
        [node.right, true],
      ]) {
        if (bound) this.expression(bound);
        else {
          this.il.emit('ldc.i4', 0);
          this.newIndex(isEnd);
        }
      }
      return this.il.emit('newobj', this.tokens.external(this.rangeType, '.ctor', shape), { pops: 2, pushes: 1 });
    }
    /** The token of `RuntimeHelpers.GetSubArray<T>(T[], Range)` for an element type. */
    subArrayMethod(elementType) {
      const helpers = frameworkType(this.core, 'System.Runtime.CompilerServices', 'RuntimeHelpers'),
        vector = this.core.arrayOf(methodTypeParameter(0)),
        shape = { isStatic: true, arity: 1, returnType: vector, parameters: [{ type: vector }, { type: this.rangeType }] };
      return this.tokens.externalGeneric(helpers, 'GetSubArray', shape, [elementType]);
    }
    /** Replaces the `Index` on the stack by its offset in a collection of the length `pushLength` pushes. */
    indexOffset(pushLength) {
      const index = this.indexType,
        slot = this.temp(index),
        shape = { isStatic: false, returnType: this.core.int, parameters: [{ type: this.core.int }] };
      this.il.emit('stloc', slot).emit('ldloca', slot);
      pushLength();
      return this.il.emit('call', this.tokens.external(index, 'GetOffset', shape), { pops: 2, pushes: 1 });
    }
    indexedAccess(node) {
      const argument = node.args?.[0]?.expression,
        receiverType = node.receiver.type;
      if (node.accessKind === 'range' && receiverType instanceof ArrayTypeSymbol) return this.subArray(node, argument);
      if (node.accessKind === 'index' && isPlainBound(argument)) return super.indexedAccess(node);
      if (node.accessKind === 'range' && argument?.kind === 'Range' && isPlainBound(argument.left) && isPlainBound(argument.right)) {
        return super.indexedAccess(node);
      }
      return this.computedAccess(node, argument);
    }
    /** `array[range]`: a node that stands for the sub-array, which is computed here into a temporary. */
    subArray(node, range) {
      const il = this.il,
        arrayType = node.receiver.type,
        slot = this.temp(arrayType),
        result = { kind: 'SubArray', syntax: node.syntax, type: arrayType, constantValue: null };
      this.expression(node.receiver);
      this.expression(range);
      il.emit('call', this.subArrayMethod(arrayType.elementType), { pops: 2, pushes: 1 });
      il.emit('stloc', slot);
      this.substitutions.set(result, { value: () => il.emit('ldloc', slot) });
      return result;
    }
    /**
     * An access whose index or range is a value: the receiver and the offsets go to temporaries, as in
     * emit-index-range.js, with the offsets taken from the `Index` values at run time.
     */
    computedAccess(node, argument) {
      const il = this.il,
        int = this.core.int,
        receiver = this.temp(node.receiver.type),
        bind = (placeholder, slot) => this.substitutions.set(placeholder, { value: () => il.emit('ldloc', slot) }),
        pushLength = () => this.expression(node.length);
      if (!node.access) return this.unsupported('a range over this type (no slicing member)', node.syntax);
      this.expression(node.receiver);
      il.emit('stloc', receiver);
      bind(node.receiverPlaceholder, receiver);
      const offsets = node.offsetPlaceholders.map(placeholder => {
        const slot = this.temp(int);
        bind(placeholder, slot);
        return slot;
      });
      if (node.accessKind === 'index') {
        this.expression(argument);
        this.indexOffset(pushLength);
        il.emit('stloc', offsets[0]);
        return node.access;
      }
      // The start, then the length: the offset of the end minus the start.
      const range = this.temp(this.rangeType);
      this.expression(argument);
      il.emit('stloc', range);
      this.rangeBound(range, 'get_Start', pushLength);
      il.emit('stloc', offsets[0]);
      this.rangeBound(range, 'get_End', pushLength);
      il.emit('ldloc', offsets[0]).emit('sub').emit('stloc', offsets[1]);
      return node.access;
    }
    /** Pushes the offset of the start or the end of the `Range` in a slot. */
    rangeBound(rangeSlot, getter, pushLength) {
      const shape = { isStatic: false, returnType: this.indexType, parameters: [] };
      this.il.emit('ldloca', rangeSlot);
      this.il.emit('call', this.tokens.external(this.rangeType, getter, shape), { pops: 1, pushes: 1 });
      return this.indexOffset(pushLength);
    }
  };
