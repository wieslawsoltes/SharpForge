/**
 * `stackalloc` (SF-A02-T30): a block of the method's frame, as a `Span<T>` or - in unsafe code - as a `T*`.
 *
 *   count * sizeof(T) as a native unsigned integer; localloc; [the initializer's elements]; [newobj Span<T>(void*, int)]
 *
 * `localloc` needs an evaluation stack that holds nothing but the size (ECMA-335 III.3.47). A stackalloc that is an
 * operand of a larger expression is reached with operands already on the stack: they are saved into temporaries and
 * pushed back under the result, which needs their types - so a body that contains a stackalloc is emitted through
 * the stream that knows them (il-stack-types.js).
 */
import { PointerTypeSymbol, TypeKind } from '../../symbols/types.js';
import { walk } from '../../bound/semantic-walker.js';
import { IlBuilder } from './il-builder.js';
import { TypedIlBuilder } from './il-stack-types.js';
import { restorePendingOperands, savePendingOperands } from './pending-operands.js';
import { primitiveOf } from './type-facts.js';

const BITS_PER_BYTE = 8;

/** True when the body contains a stackalloc of its own (functions nested in it have bodies of their own). */
function containsStackAlloc(bound) {
  let found = false;
  walk(bound, node => {
    if (node.kind === 'StackAlloc') found = true;
    return !found && node.kind !== 'Lambda' && node.kind !== 'LocalFunction';
  });
  return found;
}

/** Class mixin: stackalloc. */
export const StackAllocEmission = Base =>
  class extends Base {
    body(bound, prologue = null) {
      const il = this.il;
      if (bound && il.constructor === IlBuilder && il.position === 0 && !il.locals.length && containsStackAlloc(bound)) {
        const argumentTypes = this.frame.isStatic ? [] : [null];
        for (const parameter of this.frame.parameters) argumentTypes.push(parameter.refKind ? null : parameter.type);
        this.il = new TypedIlBuilder(this.core, argumentTypes);
        this.il.debug = this.debug;
        this.savesOperands = true;
      }
      return super.body(bound, prologue);
    }
    expression(node) {
      if (!this.savesOperands) return super.expression(node);
      const il = this.il,
        before = il.depth,
        result = super.expression(node);
      if (before !== null && il.depth === before + 1 && node.type) il.recordTop(node.type);
      return result;
    }
    /** Pushes the size of one element in bytes. */
    elementSize(type) {
      const bits = primitiveOf(type)?.bits;
      if (bits) return this.il.emit('ldc.i4', bits / BITS_PER_BYTE);
      return this.il.emit('sizeof', this.tokens.type(type));
    }
    exprStackAlloc(node) {
      const il = this.il,
        elementType = node.elementType,
        elements = node.elements ?? null,
        size = node.sizes[0] ?? null,
        isPointer = node.type.typeKind === TypeKind.Pointer;
      if (il.depth && !il.pendingTypes) return this.unsupported('stackalloc as an operand of this expression', node.syntax);
      const saved = il.depth ? this.saveOperands(node.syntax) : [];
      // The count is evaluated once; a constant count is repeated instead of stored.
      const constantCount = size?.constantValue ? Number(size.constantValue.value) : size ? null : elements.length,
        count = constantCount === null ? this.temp(this.core.int) : null,
        pushCount = () => (count === null ? il.emit('ldc.i4', constantCount) : il.emit('ldloc', count));
      if (count !== null) {
        this.expression(size);
        il.emit('stloc', count);
      }
      pushCount();
      il.emit('conv.u');
      this.elementSize(elementType);
      il.emit('mul.ovf.un').emit('localloc');
      if (elements) this.stackAllocElements(elements, elementType);
      if (!isPointer) {
        const core = this.core,
          shape = { isStatic: false, returnType: core.void, parameters: [{ type: new PointerTypeSymbol(core.void) }, { type: core.int }] };
        pushCount();
        il.emit('newobj', this.tokens.external(node.type, '.ctor', shape), { pops: 2, pushes: 1 });
      }
      if (saved.length) {
        il.recordTop(node.type);
        this.restoreOperands(saved, node.type);
      }
      return undefined;
    }
    /** Stores the elements of an initializer through the pointer on the stack, which stays there. */
    stackAllocElements(elements, elementType) {
      const il = this.il;
      elements.forEach((element, index) => {
        il.emit('dup');
        if (index) {
          il.emit('ldc.i4', index).emit('conv.i');
          this.elementSize(elementType);
          il.emit('mul').emit('add');
        }
        this.expression(element);
        this.storeIndirect(elementType);
      });
    }
    /** Empties the evaluation stack; returns what `restoreOperands` takes. */
    saveOperands(syntax) {
      const saved = savePendingOperands(this);
      return saved ?? this.unsupported('stackalloc while a value the emitter cannot save is on the evaluation stack', syntax);
    }
    /** Pushes the saved operands back, below the result. */
    restoreOperands(saved, resultType) {
      if (saved.length) return restorePendingOperands(this, saved, resultType);
      return undefined;
    }
  };
