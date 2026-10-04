/**
 * `foreach` (SF-A02-T30): over an array by index (emit-arrays.js), over a string by index, and over the enumerator
 * pattern - `GetEnumerator`, `MoveNext`, `Current`, and `Dispose` in a finally block when the enumerator is disposable.
 */
import { SymbolKind, TypeKind, RefKind } from '../../symbols/types.js';
import { implementsInterface } from '../../symbols/substitution.js';
import { isReference, primitiveOf, needsBox } from './type-facts.js';
import { enumerationPattern } from './foreach-pattern.js';

/** Class mixin: foreach. */
export const LoopEmission = Base =>
  class extends Base {
    stmtForEach(node) {
      if (!node.local) return this.unsupported('deconstruction in foreach', node.syntax);
      if (node.isAwait) return this.unsupported('await foreach with deconstruction', node.syntax);
      const type = node.collection.type;
      if (type?.elementType) return this.forEachArray(node);
      if (type?.specialType === 'System_String') return this.forEachString(node);
      return this.forEachEnumerator(node);
    }
    /** Converts the element on the stack to the iteration variable's type and stores it. */
    iterationValue(node, elementType) {
      const local = node.local;
      this.elementConversion(elementType, local.type, node.syntax);
      this.initializeLocal(local);
    }
    /** The explicit conversion `foreach (T x in ...)` applies to each element. */
    elementConversion(from, to, syntax) {
      if (!from || from.equals(to)) return undefined;
      if (primitiveOf(from) && primitiveOf(to)) return this.numericConversion(from, to, { syntax });
      if (needsBox(from) && isReference(to)) return this.il.emit('box', this.tokens.type(from));
      if (isReference(from) && needsBox(to)) return this.il.emit('unbox.any', this.tokens.type(to));
      if (isReference(from) && isReference(to)) return this.il.emit('castclass', this.tokens.type(to));
      return this.unsupported(`converting '${from.toDisplayString()}' to '${to.toDisplayString()}' in foreach`, syntax);
    }
    forEachString(node) {
      const il = this.il,
        string = this.core.string,
        text = this.temp(string),
        index = this.temp(this.core.int),
        test = il.newLabel(),
        body = il.newLabel(),
        step = il.newLabel(),
        end = il.newLabel(),
        chars = { isStatic: false, returnType: this.core.char, parameters: [{ type: this.core.int }] },
        length = { isStatic: false, returnType: this.core.int, parameters: [] };
      this.expression(node.collection);
      il.emit('stloc', text).emit('ldc.i4', 0).emit('stloc', index).emit('br', test);
      il.mark(body, 0);
      il.emit('ldloc', text).emit('ldloc', index);
      il.emit('callvirt', this.tokens.external(string, 'get_Chars', chars), { pops: 2, pushes: 1 });
      this.iterationValue(node, this.core.char);
      this.withJumpTargets({ breakLabel: end, continueLabel: step }, () => this.statement(node.body));
      il.mark(step);
      il.emit('ldloc', index).emit('ldc.i4', 1).emit('add').emit('stloc', index);
      il.mark(test);
      il.emit('ldloc', index).emit('ldloc', text);
      il.emit('callvirt', this.tokens.external(string, 'get_Length', length), { pops: 1, pushes: 1 });
      il.emit('blt', body);
      il.mark(end);
    }
    /**
     * `{ E e = c.GetEnumerator(); try { while (e.MoveNext()) { T x = e.Current; body } } finally { e.Dispose(); } }`.
     */
    forEachEnumerator(node) {
      const collectionType = node.collection.type,
        pattern = enumerationPattern(collectionType, this.core, node.extensionGetEnumerator ?? null);
      if (!pattern) return this.unsupported('foreach over a type that cannot be enumerated', node.syntax);
      const { getEnumerator, viaInterface, enumeratorType, moveNext, current } = pattern,
        il = this.il,
        enumerator = this.temp(enumeratorType),
        receiver = { kind: 'Temporary', type: enumeratorType },
        pushEnumerator = () => il.emit(isReference(enumeratorType) ? 'ldloc' : 'ldloca', enumerator);
      if (node.extensionGetEnumerator) {
        this.expression(node.collection);
        this.callMethod(getEnumerator, {});
      } else if (viaInterface) {
        // The collection implements the interface explicitly: it is enumerated as the interface.
        this.expression(node.collection);
        if (needsBox(collectionType)) il.emit('box', this.tokens.type(collectionType));
        this.callMethod(getEnumerator, { receiver: { type: viaInterface } });
      } else {
        this.receiver(node.collection);
        this.callMethod(getEnumerator, { receiver: node.collection });
      }
      il.emit('stloc', enumerator);
      const loop = () => {
        const test = il.newLabel(),
          body = il.newLabel(),
          end = il.newLabel();
        il.emit('br', test);
        il.mark(body, 0);
        pushEnumerator();
        this.callMethod(current.getMethod, { receiver });
        const returnsReference = !!current.refKind && current.refKind !== RefKind.None,
          aliases = returnsReference && !!node.local.refKind && node.local.refKind !== RefKind.None;
        // `foreach (ref var x in ...)`: the variable is the reference `Current` returns (the slot is by-reference).
        if (aliases) il.emit('stloc', this.slotOf(node.local));
        else {
          // `Current` of a span enumerator returns the element by reference; the iteration variable is its value.
          if (returnsReference) this.loadIndirect(current.type);
          this.iterationValue(node, current.type);
        }
        this.withJumpTargets({ breakLabel: end, continueLabel: test }, () => this.statement(node.body));
        il.mark(test);
        pushEnumerator();
        this.callMethod(moveNext, { receiver });
        il.emit('brtrue', body);
        il.mark(end);
      };
      if (implementsInterface(enumeratorType, this.core.idisposable, this.core)) {
        return this.tryRegions(loop, [], () => this.disposeCall({ slot: enumerator, type: enumeratorType }, node.syntax));
      }
      // An enumerator known only as an interface (`IEnumerator`) may be disposable at run time.
      if (enumeratorType.typeKind !== TypeKind.Interface) return loop();
      return this.tryRegions(loop, [], () => this.disposeIfDisposable(enumerator));
    }
    /** `(e as IDisposable)?.Dispose()` for an enumerator whose static type is not disposable. */
    disposeIfDisposable(enumerator) {
      const il = this.il,
        disposable = this.core.idisposable,
        dispose = disposable.getMembers('Dispose').find(member => member.kind === SymbolKind.Method && !member.parameters.length),
        skip = il.newLabel(),
        asDisposable = this.temp(disposable);
      il.emit('ldloc', enumerator).emit('isinst', this.tokens.type(disposable)).emit('stloc', asDisposable);
      il.emit('ldloc', asDisposable).emit('brfalse', skip).emit('ldloc', asDisposable);
      this.callMethod(dispose, { receiver: { type: disposable } });
      il.mark(skip);
    }
  };
