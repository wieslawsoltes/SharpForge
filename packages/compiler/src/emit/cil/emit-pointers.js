/**
 * Pointers (unsafe code, SF-A02-T30). A pointer is a native unsigned integer on the evaluation stack:
 *
 *   &x                 the address of the variable, `conv.u`
 *   *p, p->M, p[i]     the variable at the address: read `ldind` / `ldobj`, written `stind` / `stobj`
 *   p + n, p - n       `n` as a native integer times `sizeof(T)`;  p - q  the byte distance divided by `sizeof(T)`
 *   == != < > <= >=    unsigned comparisons;  ++ --  one element forward or back
 *   (T*)p, (void*)p    nothing;  (long)p  `conv.u8`;  (T*)n  `conv.i` / `conv.u`;  null  `ldc.i4.0; conv.u`
 *   sizeof(T)          a constant for the predefined types, else the `sizeof` instruction
 *   unsafe { }         its block
 *
 * The `fixed` statement is in emit-fixed.js.
 */
import { TypeKind } from '../../symbols/types.js';
import { primitiveOf } from './type-facts.js';

const isPointer = type => type?.typeKind === TypeKind.Pointer;
const comparisons = Object.freeze({ '<': ['clt.un'], '>': ['cgt.un'], '<=': ['cgt.un', 'not'], '>=': ['clt.un', 'not'], '==': ['ceq'], '!=': ['ceq', 'not'] });
const pointerConversions = new Set(['ImplicitPointerToVoid', 'ExplicitPointerToPointer', 'ExplicitPointerToInteger', 'ExplicitIntegerToPointer']);

/** The variable a pointer designates: its address is the pointer value an emitter callback pushes. */
class PointerLocation {
  /** @param {() => void} pushPointer evaluates the pointer  @param type the type of the variable */
  constructor(emitter, pushPointer, type) {
    this.emitter = emitter;
    this.pushPointer = pushPointer;
    this.type = type;
    this.slot = null;
  }
  capture() {
    if (this.slot !== null) return;
    this.pushPointer();
    this.slot = this.emitter.temp(this.emitter.core.uintPtr ?? this.emitter.core.intPtr);
    this.emitter.il.emit('stloc', this.slot);
  }
  address() {
    if (this.slot === null) this.pushPointer();
    else this.emitter.il.emit('ldloc', this.slot);
  }
  load() {
    this.address();
    this.emitter.loadIndirect(this.type);
  }
  beginStore() {
    this.address();
  }
  endStore() {
    this.emitter.storeIndirect(this.type);
  }
}

/** Class mixin: pointers. */
export const PointerEmission = Base =>
  class extends Base {
    stmtUnsafe(node) {
      return this.statement(node.block);
    }
    /** `sizeof(T)` of a type whose size the compiler does not know: the runtime's layout decides. */
    exprSizeOf(node) {
      return this.elementSize(node.operandType);
    }
    /** A null or default pointer is the address zero. */
    defaultValue(type) {
      if (!isPointer(type)) return super.defaultValue(type);
      return this.il.emit('ldc.i4', 0).emit('conv.u');
    }
    loadIndirect(type) {
      if (!isPointer(type)) return super.loadIndirect(type);
      return this.il.emit('ldind.i');
    }
    storeIndirect(type) {
      if (!isPointer(type)) return super.storeIndirect(type);
      return this.il.emit('stind.i');
    }
    exprAddressOf(node) {
      this.address(node.operand);
      return this.il.emit('conv.u');
    }
    /** The planned buffer of a fixed-size buffer field (fixed-buffers.js), or null for any other node. */
    fixedBufferOf(node) {
      const definition = node.kind === 'FieldAccess' ? (node.field.originalDefinition ?? node.field) : null;
      if (!definition?.isFixedSizeBuffer) return null;
      const buffer = this.program.fixedBuffers.get(definition);
      // Not planned: a buffer of a generic struct (fixed-buffers.js), or a length that is not a constant.
      if (!buffer || buffer.length === null) return this.unsupported('this fixed-size buffer', node.syntax);
      return buffer;
    }
    /** Pushes the managed address of element 0 of a fixed-size buffer: `&receiver.Buffer.FixedElementField`. */
    fixedBufferAddress(node, buffer) {
      super.fieldLocation(node.field, node.receiver, buffer.type).address();
      this.il.emit('ldflda', this.tokens.planned(buffer.elementField, buffer.type));
    }
    /** Naming a fixed-size buffer yields a pointer to its first element. */
    exprFieldAccess(node) {
      const buffer = this.fixedBufferOf(node);
      if (!buffer) return super.exprFieldAccess(node);
      this.fixedBufferAddress(node, buffer);
      return this.il.emit('conv.u');
    }
    /** Pushes the address `pointer + index * sizeof(T)`. */
    elementPointer(node) {
      const il = this.il,
        index = node.index,
        buffer = this.fixedBufferOf(node.pointer);
      // An element of a buffer in a variable that may move is reached from the managed address, which follows it.
      if (buffer) this.fixedBufferAddress(node.pointer, buffer);
      else this.expression(node.pointer);
      if (index.constantValue && Number(index.constantValue.value) === 0) return;
      this.scaledOffset(index, node.type);
      il.emit('add');
    }
    /** Pushes an integer operand as a native integer multiplied by the element size. */
    scaledOffset(offset, elementType) {
      const il = this.il,
        facts = primitiveOf(offset.type);
      this.expression(offset);
      il.emit(facts && !facts.isSigned ? 'conv.u' : 'conv.i');
      this.elementSize(elementType);
      il.emit('mul');
    }
    pointerLocation(node) {
      if (node.kind === 'PointerIndirection') return new PointerLocation(this, () => this.expression(node.operand), node.type);
      return new PointerLocation(this, () => this.elementPointer(node), node.type);
    }
    exprPointerIndirection(node) {
      this.pointerLocation(node).load();
    }
    exprPointerElementAccess(node) {
      this.pointerLocation(node).load();
    }
    location(node) {
      if (node.kind === 'PointerIndirection' || node.kind === 'PointerElementAccess') return this.pointerLocation(node);
      return super.location(node);
    }
    /** The address of `*p` or `p[i]` is the pointer itself: a member of the struct it designates is reached in place. */
    address(node) {
      if (node.kind === 'PointerIndirection' || node.kind === 'PointerElementAccess') return this.pointerLocation(node).address();
      return super.address(node);
    }
    exprBinary(node) {
      if (node.family !== 'pointer' || node.method) return super.exprBinary(node);
      const il = this.il,
        { left, right, operator } = node;
      if (comparisons[operator]) {
        this.expression(left);
        this.expression(right);
        for (const instruction of comparisons[operator]) {
          if (instruction === 'not') il.emit('ldc.i4', 0).emit('ceq');
          else il.emit(instruction);
        }
        return undefined;
      }
      if (isPointer(left.type) && isPointer(right.type)) {
        // The distance in elements, as a long.
        this.expression(left);
        this.expression(right);
        il.emit('sub');
        this.elementSize(left.type.pointedAtType);
        return il.emit('div').emit('conv.i8');
      }
      const pointerFirst = isPointer(left.type),
        elementType = (pointerFirst ? left : right).type.pointedAtType;
      if (pointerFirst) {
        this.expression(left);
        this.scaledOffset(right, elementType);
      } else {
        this.scaledOffset(left, elementType);
        this.expression(right);
      }
      return il.emit(operator === '+' ? 'add' : 'sub');
    }
    /** `p++` and `p--` move by one element. */
    addOne(node, type) {
      if (!isPointer(type)) return super.addOne(node, type);
      this.elementSize(type.pointedAtType);
      return this.il.emit(node.operator === '++' ? 'add' : 'sub');
    }
    exprConversion(node) {
      const kind = node.conversion?.kind;
      if (!pointerConversions.has(kind)) return super.exprConversion(node);
      this.expression(node.operand);
      if (kind === 'ExplicitPointerToInteger') {
        const facts = primitiveOf(node.type);
        // The address is unsigned: a wider integer takes it zero-extended.
        return this.il.emit(facts.bits === 64 ? 'conv.u8' : 'conv.' + facts.suffix);
      }
      if (kind === 'ExplicitIntegerToPointer') {
        const facts = primitiveOf(node.operand.type);
        return this.il.emit(facts.isSigned ? 'conv.i' : 'conv.u');
      }
      return undefined;
    }
  };
