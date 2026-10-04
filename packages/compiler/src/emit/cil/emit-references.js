/**
 * By-reference values (SF-A02-T30): `ref` expressions, methods and properties that return by reference, and
 * `return ref`. A reference is a managed pointer on the stack; reading through it is `ldind` / `ldobj` and writing
 * `stind` / `stobj` (emit-variables.js). `ref` / `out` / `in` arguments and ref locals are emitted there and in
 * emit-calls.js.
 */
import { RefKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { isReference } from './type-facts.js';

const isByReferenceKind = refKind => !!refKind && refKind !== RefKind.None;
const returnsByReference = method => isByReferenceKind(method?.refKind);

/** A variable reached through a managed pointer that an expression produces (the result of a ref-returning call). */
class IndirectLocation {
  /** @param {() => void} pushAddress evaluates the expression  @param type the type of the variable */
  constructor(emitter, pushAddress, type) {
    this.emitter = emitter;
    this.pushAddress = pushAddress;
    this.type = type;
    this.slot = null;
  }
  capture() {
    if (this.slot !== null) return;
    this.pushAddress();
    this.slot = this.emitter.temp(this.type, { isByReference: true });
    this.emitter.il.emit('stloc', this.slot);
  }
  address() {
    if (this.slot === null) this.pushAddress();
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

/** Class mixin: by-reference values. */
export const ReferenceEmission = Base =>
  class extends Base {
    /** True for a call whose result is a managed pointer to a variable. */
    isReferenceCall(node) {
      return node.kind === 'Call' && node.method?.methodKind !== MethodKind.DelegateInvoke && returnsByReference(node.method);
    }
    /** `ref x` denotes the variable itself: its address. */
    exprRef(node) {
      return this.address(node.operand);
    }
    /** A ref-returning call used as a value reads the variable it returns. */
    exprCall(node, isUsed) {
      const result = super.exprCall(node, isUsed);
      if (this.isReferenceCall(node) && !this.returningReference) this.loadIndirect(node.type);
      return result;
    }
    /** Emits a ref-returning call and leaves the managed pointer on the stack. */
    referenceCall(node) {
      const outer = this.returningReference;
      this.returningReference = true;
      try {
        return super.exprCall(node, true);
      } finally {
        this.returningReference = outer;
      }
    }
    /** `c ? ref a : ref b` denotes one of two variables: the address of the chosen one is on the stack. */
    refConditionalAddress(node) {
      const il = this.il,
        otherwise = il.newLabel(),
        end = il.newLabel();
      this.branchOn(node.condition, otherwise, false);
      this.address(node.whenTrue);
      il.emit('br', end);
      il.mark(otherwise);
      this.address(node.whenFalse);
      il.mark(end);
    }
    exprRefConditional(node) {
      this.refConditionalAddress(node);
      this.loadIndirect(node.type);
    }
    address(node) {
      if (node.kind === 'Ref') return this.address(node.operand);
      if (node.kind === 'RefConditional') return this.refConditionalAddress(node);
      if (this.isReferenceCall(node)) return this.referenceCall(node);
      if ((node.kind === 'PropertyAccess' || node.kind === 'IndexerAccess') && returnsByReference(node.property)) {
        return this.propertyLocation(node).address();
      }
      return super.address(node);
    }
    /**
     * A property or indexer that returns by reference (`ref T this[int]` of `Span<T>`) denotes the variable its
     * getter returns: reading, writing and `ref` go through the managed pointer.
     */
    propertyLocation(node) {
      const accessors = super.propertyLocation(node);
      if (!returnsByReference(node.property)) return accessors;
      return new IndirectLocation(this, () => accessors.load(), node.type);
    }
    /** A `ref` field (C# 11) holds a managed pointer: the variable it denotes is read and written through it. */
    fieldLocation(field, receiver, type) {
      const storage = super.fieldLocation(field, receiver, type);
      if (!isByReferenceKind(field.refKind)) return storage;
      return new IndirectLocation(this, () => storage.load(), type);
    }
    location(node) {
      if (node.kind === 'RefConditional') return new IndirectLocation(this, () => this.refConditionalAddress(node), node.type);
      if (this.isReferenceCall(node)) return new IndirectLocation(this, () => this.referenceCall(node), node.type);
      // `this = value` in a struct stores the whole value through the managed pointer the method received.
      if (node.kind === 'This' && !this.frame.isStatic && !isReference(this.frame.containingType) && !this.frame.function?.closure) {
        return new IndirectLocation(this, () => this.pushFrameObject(), this.frame.containingType);
      }
      return super.location(node);
    }
    /** `r = ref x` makes the ref local (or ref parameter) denote another variable; its value is the variable's value. */
    exprRefAssignment(node, isUsed) {
      const target = node.left,
        il = this.il;
      if (target.kind === 'FieldAccess' && isByReferenceKind(target.field.refKind)) {
        // The field itself is assigned: the pointer is stored where the field is, not through what it held.
        const storage = super.fieldLocation(target.field, target.receiver, target.type);
        storage.beginStore();
        this.address(node.right);
        storage.endStore();
      } else {
        this.address(node.right);
        if (target.kind === 'Local') il.emit('stloc', this.slotOf(target.local));
        else if (target.kind === 'Parameter') il.emit('starg', this.argumentIndexOf(target.parameter, node.syntax));
        else return this.unsupported('ref assignment to this target', node.syntax);
      }
      if (isUsed) this.expression(target);
      return isUsed ? undefined : false;
    }
    /** `return ref x;` returns the address of the variable. */
    stmtReturn(node) {
      const byReference = node.isRef || returnsByReference(this.frame.method);
      if (!byReference || !node.expression) return super.stmtReturn(node);
      if (this.protectedDepth) return this.unsupported('return ref inside a protected region', node.syntax);
      this.address(node.expression);
      return this.il.emit('ret', undefined, { pops: 1, pushes: 0 });
    }
    expressionBody(expression, isReturn) {
      if (!isReturn || !returnsByReference(this.frame.method)) return super.expressionBody(expression, isReturn);
      this.address(expression);
      return this.il.emit('ret', undefined, { pops: 1, pushes: 0 });
    }
  };
