/**
 * The `fixed` statement (unsafe code, SF-A02-T30): a variable the garbage collector may move is pinned through a
 * `pinned` local for the duration of the statement, and the pointer the statement declares is derived from it.
 *
 *   fixed (T* p = &variable)   a pinned `T&` to the variable;  p = (T*)that
 *   fixed (T* p = array)       a pinned `T[]`;  p = null for a null or empty array, else the address of element 0
 *   fixed (char* p = text)     a pinned `string`;  p = the string's address plus `RuntimeHelpers.OffsetToStringData`
 *   fixed (T* p = value)       a pinned `T&` from `value.GetPinnableReference()` (C# 7.3)
 *   fixed (T* p = s.Buffer)    a pinned `T&` to element 0 of a fixed-size buffer
 *
 * The pinned locals are cleared when the body completes, in reverse order.
 */
import { SymbolKind, ArrayTypeSymbol, RefKind } from '../../symbols/types.js';
import { frameworkType } from './framework-types.js';
import { isReference } from './type-facts.js';

const pointerConversions = new Set(['ImplicitPointerToVoid', 'ExplicitPointerToPointer', 'Identity']);

/** The initializer under the conversion to the declared pointer type. */
function initializerOf(value) {
  let initializer = value;
  while (initializer.kind === 'Conversion' && pointerConversions.has(initializer.conversion?.kind)) initializer = initializer.operand;
  return initializer;
}

/** Class mixin: the fixed statement. */
export const FixedEmission = Base =>
  class extends Base {
    stmtFixed(node) {
      const releases = [];
      for (const { local, value } of node.declaration) releases.push(this.pin(local, value, node.syntax));
      this.statement(node.body);
      for (const release of releases.reverse()) release();
    }
    /** Pins what one declarator names and stores the pointer in its local. @returns {() => void} emits the unpinning */
    pin(local, value, syntax) {
      const initializer = value ? initializerOf(value) : null,
        slot = this.slotOf(local);
      if (initializer?.kind === 'AddressOf') return this.pinVariable(initializer.operand, slot);
      if (initializer?.kind !== 'FixedInitializer') return this.unsupported('this fixed statement initializer', syntax);
      const operand = initializer.operand,
        type = operand.type;
      const buffer = this.fixedBufferOf(operand);
      if (buffer) {
        this.fixedBufferAddress(operand, buffer);
        return this.pinReference(buffer.elementType, slot);
      }
      if (type instanceof ArrayTypeSymbol) return this.pinArray(operand, slot);
      if (type?.specialType === 'System_String') return this.pinString(operand, slot);
      return this.pinThroughReference(operand, slot, syntax);
    }
    /** Stores the pinned managed pointer on the stack and the pointer derived from it. */
    pinReference(elementType, slot) {
      const il = this.il,
        pinned = il.declareLocal(elementType, { isByReference: true, isPinned: true });
      il.emit('stloc', pinned).emit('ldloc', pinned).emit('conv.u').emit('stloc', slot);
      return () => il.emit('ldc.i4', 0).emit('conv.u').emit('stloc', pinned);
    }
    pinVariable(variable, slot) {
      this.address(variable);
      return this.pinReference(variable.type, slot);
    }
    pinArray(array, slot) {
      const il = this.il,
        elementType = array.type.elementType,
        pinned = il.declareLocal(array.type, { isPinned: true }),
        empty = il.newLabel(),
        done = il.newLabel();
      this.expression(array);
      il.emit('dup').emit('stloc', pinned).emit('brfalse', empty);
      il.emit('ldloc', pinned).emit('ldlen').emit('conv.i4').emit('brfalse', empty);
      il.emit('ldloc', pinned).emit('ldc.i4', 0).emit('ldelema', this.tokens.type(elementType)).emit('conv.u').emit('stloc', slot);
      il.emit('br', done);
      il.mark(empty);
      il.emit('ldc.i4', 0).emit('conv.u').emit('stloc', slot);
      il.mark(done);
      return () => il.emit('ldnull').emit('stloc', pinned);
    }
    pinString(text, slot) {
      const il = this.il,
        core = this.core,
        pinned = il.declareLocal(core.string, { isPinned: true }),
        isNull = il.newLabel(),
        helpers = frameworkType(core, 'System.Runtime.CompilerServices', 'RuntimeHelpers'),
        shape = { isStatic: true, returnType: core.int, parameters: [] };
      this.expression(text);
      il.emit('stloc', pinned).emit('ldloc', pinned).emit('conv.u').emit('stloc', slot);
      il.emit('ldloc', slot).emit('brfalse', isNull);
      il.emit('ldloc', slot).emit('call', this.tokens.external(helpers, 'get_OffsetToStringData', shape), { pops: 0, pushes: 1 });
      il.emit('add').emit('stloc', slot);
      il.mark(isNull);
      return () => il.emit('ldnull').emit('stloc', pinned);
    }
    /** C# 7.3: any value with an instance `ref T GetPinnableReference()`; a null reference gives a null pointer. */
    pinThroughReference(value, slot, syntax) {
      const il = this.il,
        type = value.type,
        returnsReference = method => (method.refKind ?? RefKind.None) !== RefKind.None,
        method = type
          ?.getMembers('GetPinnableReference')
          .find(member => member.kind === SymbolKind.Method && !member.isStatic && !member.parameters.length && returnsReference(member));
      if (!method) return this.unsupported('this fixed statement initializer', syntax);
      const pinned = il.declareLocal(method.returnType, { isByReference: true, isPinned: true }),
        release = () => il.emit('ldc.i4', 0).emit('conv.u').emit('stloc', pinned),
        store = () => il.emit('stloc', pinned).emit('ldloc', pinned).emit('conv.u').emit('stloc', slot);
      if (!isReference(type)) {
        this.receiver(value);
        this.callMethod(method, { receiver: value, syntax });
        store();
        return release;
      }
      const isNull = il.newLabel(),
        done = il.newLabel(),
        object = this.temp(type);
      this.expression(value);
      il.emit('stloc', object).emit('ldloc', object).emit('brfalse', isNull);
      il.emit('ldloc', object);
      this.callMethod(method, { receiver: value, syntax });
      store();
      il.emit('br', done);
      il.mark(isNull);
      il.emit('ldc.i4', 0).emit('conv.u').emit('stloc', slot);
      il.mark(done);
      return release;
    }
  };
