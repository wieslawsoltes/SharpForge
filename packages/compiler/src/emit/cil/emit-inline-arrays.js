/**
 * Inline arrays in direct CIL (C# 12, SF-A02-T80). CLR layout comes from InlineArrayAttribute. Unsafe.As obtains the
 * first element's managed reference; MemoryMarshal makes a bounded span over the same storage, including managed
 * elements. The span indexer provides runtime bounds checks and the existing location protocol handles assignments.
 */
import { RefKind, SymbolKind } from '../../symbols/types.js';
import { inlineArrayShape } from '../../symbols/inline-arrays.js';
import { frameworkType, methodTypeParameter } from './framework-types.js';

/** An element location captures the managed reference once before a compound read/write. */
class InlineElementLocation {
  constructor(emitter, node) {
    this.emitter = emitter;
    this.node = node;
    this.type = node.type;
    this.slot = null;
  }
  capture() {
    if (this.slot !== null) return;
    this.emitter.inlineArrayElementAddress(this.node);
    this.slot = this.emitter.temp(this.type, { isByReference: true });
    this.emitter.il.emit('stloc', this.slot);
  }
  address() {
    if (this.slot === null) this.emitter.inlineArrayElementAddress(this.node);
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

/** Direct CIL construct family, registered after reference and Index/Range emission. */
export const InlineArrayEmission = Base =>
  class extends Base {
    exprInlineArrayAccess(node) {
      this.inlineArrayElementAddress(node);
      this.loadIndirect(node.type);
    }
    location(node) {
      return node.kind === 'InlineArrayAccess' ? new InlineElementLocation(this, node) : super.location(node);
    }
    address(node) {
      return node.kind === 'InlineArrayAccess' ? this.inlineArrayElementAddress(node) : super.address(node);
    }
    /** Pushes the first element's reference without accessing the private backing field. */
    inlineArrayFirstAddress(receiver, elementType) {
      const unsafe = frameworkType(this.core, 'System.Runtime.CompilerServices', 'Unsafe');
      const shape = {
        isStatic: true,
        arity: 2,
        refKind: RefKind.Ref,
        returnType: methodTypeParameter(1),
        parameters: [{ type: methodTypeParameter(0), refKind: RefKind.Ref }],
      };
      this.address(receiver);
      this.il.emit('call', this.tokens.externalGeneric(unsafe, 'As', shape, [receiver.type, elementType]), { pops: 1, pushes: 1 });
    }
    /** Pushes a Span<E> or ReadOnlySpan<E> borrowing the whole inline-array receiver. */
    inlineArraySpan(receiver, type, length) {
      const elementType = type.typeArguments[0].type;
      const readOnly = type.originalDefinition === this.core.readOnlySpan;
      const owner = frameworkType(this.core, 'System.Runtime.InteropServices', 'MemoryMarshal');
      const shape = {
        isStatic: true,
        arity: 1,
        returnType: type.originalDefinition.construct(methodTypeParameter(0)),
        parameters: [{ type: methodTypeParameter(0), refKind: RefKind.Ref }, { type: this.core.int }],
      };
      this.inlineArrayFirstAddress(receiver, elementType);
      this.il.emit('ldc.i4', length);
      const token = this.tokens.externalGeneric(owner, readOnly ? 'CreateReadOnlySpan' : 'CreateSpan', shape, [elementType]);
      this.il.emit('call', token, { pops: 2, pushes: 1 });
      this.il.recordTop?.(type);
    }
    exprInlineArrayConversion(node) {
      this.inlineArraySpan(node.operand, node.type, node.length);
    }
    /** Compile-time checked offsets use Unsafe.Add; runtime indices use the checked span indexer. */
    inlineArrayElementAddress(node) {
      if (node.constantOffset !== null && node.constantOffset !== undefined) {
        this.inlineArrayFirstAddress(node.receiver, node.type);
        if (node.constantOffset !== 0) this.inlineArrayConstantOffset(node.type, node.constantOffset);
        return;
      }
      const type = this.core.span.construct(node.type);
      const span = this.temp(type);
      this.inlineArraySpan(node.receiver, type, node.length);
      this.il.emit('stloc', span).emit('ldloca', span);
      this.inlineArrayOffset(node);
      this.callInlineSpanMember(type, 'get_Item', 1);
    }
    inlineArrayConstantOffset(elementType, offset) {
      const unsafe = frameworkType(this.core, 'System.Runtime.CompilerServices', 'Unsafe');
      const element = methodTypeParameter(0);
      const shape = {
        isStatic: true, arity: 1, returnType: element, refKind: RefKind.Ref,
        parameters: [{ type: element, refKind: RefKind.Ref }, { type: this.core.int }],
      };
      this.il.emit('ldc.i4', offset);
      this.il.emit('call', this.tokens.externalGeneric(unsafe, 'Add', shape, [elementType]), { pops: 2, pushes: 1 });
    }
    /** Pushes the int offset while preserving receiver-before-index evaluation. */
    inlineArrayOffset(node) {
      if (node.constantOffset !== null && node.constantOffset !== undefined) return this.il.emit('ldc.i4', node.constantOffset);
      if (node.indexKind === 'int') return this.expression(node.index);
      if (node.index.kind === 'FromEndIndex') {
        this.il.emit('ldc.i4', node.length);
        this.expression(node.index.operand);
        return this.il.emit('sub');
      }
      this.expression(node.index);
      return this.indexOffset(() => this.il.emit('ldc.i4', node.length));
    }
    /** Calls a span method through its symbol so imported custom modifiers and generic substitutions are retained. */
    callInlineSpanMember(type, name, parameterCount) {
      const method = type.getMembers(name).find(member => member.kind === SymbolKind.Method && member.parameters.length === parameterCount);
      if (!method) return this.unsupported(`the inline-array helper '${type.toDisplayString()}.${name}'`, null);
      this.il.emit('call', this.tokens.method(method), { pops: parameterCount + 1, pushes: 1 });
    }
    exprInlineArraySlice(node) {
      const span = this.temp(node.type);
      const range = this.temp(this.rangeType);
      const start = this.temp(this.core.int);
      const end = this.temp(this.core.int);
      const pushLength = () => this.il.emit('ldc.i4', node.length);
      this.inlineArraySpan(node.receiver, node.type, node.length);
      this.il.emit('stloc', span);
      this.expression(node.range);
      this.il.emit('stloc', range);
      this.rangeBound(range, 'get_Start', pushLength);
      this.il.emit('stloc', start);
      this.rangeBound(range, 'get_End', pushLength);
      this.il.emit('stloc', end).emit('ldloca', span).emit('ldloc', start).emit('ldloc', end).emit('ldloc', start).emit('sub');
      this.callInlineSpanMember(node.type, 'Slice', 2);
    }
    stmtForEach(node) {
      const shape = inlineArrayShape(node.collection?.type);
      return shape && !node.isAwait ? this.forEachInlineArray(node, shape) : super.stmtForEach(node);
    }
    /** Enumerates the original storage once; an rvalue receiver is copied into a temporary by address(). */
    forEachInlineArray(node, shape) {
      const il = this.il;
      const type = this.core.span.construct(shape.elementType);
      const span = this.temp(type);
      const index = this.temp(this.core.int);
      const test = il.newLabel();
      const body = il.newLabel();
      const step = il.newLabel();
      const end = il.newLabel();
      this.inlineArraySpan(node.collection, type, shape.length);
      il.emit('stloc', span).emit('ldc.i4', 0).emit('stloc', index).emit('br', test);
      il.mark(body, 0);
      il.emit('ldloca', span).emit('ldloc', index);
      this.callInlineSpanMember(type, 'get_Item', 1);
      if (node.local.refKind && node.local.refKind !== RefKind.None) this.initializeLocal(node.local);
      else {
        this.loadIndirect(shape.elementType);
        this.iterationValue(node, shape.elementType);
      }
      this.withJumpTargets({ breakLabel: end, continueLabel: step }, () => this.statement(node.body));
      il.mark(step);
      il.emit('ldloc', index).emit('ldc.i4', 1).emit('add').emit('stloc', index);
      il.mark(test);
      il.emit('ldloc', index).emit('ldc.i4', shape.length).emit('blt', body);
      il.mark(end);
    }
  };
