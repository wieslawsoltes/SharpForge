/**
 * Exception regions (SF-A02-T30): `try` with typed `catch` clauses and `finally`, `throw`, rethrow and `using`.
 *
 * A try statement with both catch clauses and a finally block is two nested regions, the catch clauses inside
 * (ECMA-335 II.19): clauses are recorded innermost first, in the order II.25.4.6 requires.
 */
import { SymbolKind, TypeKind, Accessibility } from '../../symbols/types.js';
import { isReference } from './type-facts.js';

/** Class mixin: exception handling. */
export const ExceptionEmission = Base =>
  class extends Base {
    stmtThrow(node) {
      if (!node.expression) return this.il.emit('rethrow');
      this.expression(node.expression);
      return this.il.emit('throw');
    }
    /** A throw in expression position: the stack is abandoned, and the code after it is unreachable. */
    throwExpression(node) {
      this.expression(node.operand ?? node.expression);
      this.il.emit('throw');
    }
    exprThrow(node) {
      this.throwExpression(node);
    }
    /** Emits code inside a protected region: jumps out of it become `leave`. */
    protect(emitRegion) {
      this.protectedDepth++;
      try {
        emitRegion();
      } finally {
        this.protectedDepth--;
      }
    }
    stmtTry(node) {
      this.tryRegions(
        () => this.statement(node.body),
        node.catches ?? [],
        node.finallyBlock ? () => this.statement(node.finallyBlock) : null,
      );
    }
    /**
     * @param {() => void} emitBody the protected statements  @param {object[]} catches bound catch clauses
     * @param {(() => void)|null} emitFinally the finally block, or null
     */
    tryRegions(emitBody, catches, emitFinally) {
      const il = this.il,
        end = il.newLabel(),
        outerStart = il.newLabel(),
        afterCatches = emitFinally && catches.length ? il.newLabel() : end;
      il.mark(outerStart);
      this.protect(() => {
        if (catches.length) this.catchRegions(emitBody, catches, afterCatches);
        else {
          emitBody();
          if (il.isReachable) il.emit('leave', end);
        }
        if (afterCatches !== end) {
          il.mark(afterCatches);
          il.emit('leave', end);
        }
      });
      if (emitFinally) {
        const handlerStart = il.newLabel(),
          handlerEnd = il.newLabel();
        il.mark(handlerStart, 0);
        this.protect(emitFinally);
        if (il.isReachable) il.emit('endfinally');
        il.mark(handlerEnd);
        il.addRegion({ kind: 'finally', tryStart: outerStart, tryEnd: handlerStart, handlerStart, handlerEnd });
        // `handlerEnd` and `end` are the same offset; both are marked so that each region owns its labels.
      }
      il.mark(end);
    }
    catchRegions(emitBody, catches, exit) {
      const il = this.il,
        tryStart = il.newLabel(),
        tryEnd = il.newLabel();
      il.mark(tryStart);
      emitBody();
      if (il.isReachable) il.emit('leave', exit);
      let handlerStart = tryEnd;
      for (const clause of catches) {
        if (clause.filter) return this.unsupported('exception filters', clause.syntax);
        const handlerEnd = il.newLabel(),
          type = clause.type ?? this.core.object;
        il.mark(handlerStart, 1);
        if (clause.local) this.initializeLocal(clause.local);
        else il.emit('pop');
        this.statement(clause.block);
        if (il.isReachable) il.emit('leave', exit);
        il.addRegion({ kind: 'catch', tryStart, tryEnd, handlerStart, handlerEnd, catchType: this.tokens.type(type) });
        handlerStart = handlerEnd;
      }
      // The end of the last handler: a boundary only, nothing falls into it.
      il.mark(handlerStart);
      return undefined;
    }
    /** `using (R r = e) body` is `{ R r = e; try body finally { if (r != null) r.Dispose(); } }`. */
    stmtUsing(node) {
      if (node.isAwait) return this.unsupported('await using', node.syntax);
      const resources = [];
      if (Array.isArray(node.resources)) {
        for (const declarator of node.resources) {
          this.declare(declarator.local, declarator.value);
          resources.push({ slot: this.slotOf(declarator.local), type: declarator.local.type });
        }
      } else if (node.resources) {
        const slot = this.temp(node.resources.type);
        this.expression(node.resources);
        this.il.emit('stloc', slot);
        resources.push({ slot, type: node.resources.type });
      }
      return this.disposeAround(resources, 0, () => this.statement(node.body), node.syntax);
    }
    /** Nested try-finally regions, one per resource, the first resource outermost. */
    disposeAround(resources, index, emitBody, syntax) {
      if (index === resources.length) return emitBody();
      const resource = resources[index];
      return this.tryRegions(
        () => this.disposeAround(resources, index + 1, emitBody, syntax),
        [],
        () => this.disposeCall(resource, syntax),
      );
    }
    disposeCall({ slot, type }, syntax) {
      const il = this.il,
        dispose = this.disposeMethodOf(type, syntax);
      if (!isReference(type)) {
        // A struct resource is disposed in place, through the method it declares.
        il.emit('ldloca', slot);
        return this.callMethod(dispose, { receiver: { type } });
      }
      const skip = il.newLabel();
      il.emit('ldloc', slot).emit('brfalse', skip).emit('ldloc', slot);
      this.callMethod(dispose, { receiver: { type } });
      il.mark(skip);
      return undefined;
    }
    /**
     * The method that disposes a resource. A struct is disposed through the `Dispose` it declares. A class is disposed
     * through `IDisposable.Dispose`, named by the class's own implicit implementation when no class derived from it
     * implements the interface again - the same method the interface call would reach, without leaving the assembly.
     */
    disposeMethodOf(type, syntax) {
      const isDispose = member =>
        member.kind === SymbolKind.Method && !member.isStatic && !member.parameters.length && member.name === 'Dispose';
      if (!isReference(type)) return type.getMembers('Dispose').find(isDispose) ?? this.unsupported(`disposing '${type.toDisplayString()}'`, syntax);
      const disposable = this.core.idisposable,
        declared = this.implicitImplementation(type, isDispose);
      if (declared && !this.isReimplementedBelow(type, disposable)) return declared;
      return disposable.getMembers('Dispose').find(isDispose) ?? this.unsupported(`disposing '${type.toDisplayString()}'`, syntax);
    }
    /** The public member matching `predicate` that the nearest source class of `type` declares, or null. */
    implicitImplementation(type, predicate) {
      for (let current = type; current?.isSource && current.typeKind === TypeKind.Class; current = current.baseType) {
        const member = current.getMembers().find(candidate => predicate(candidate) && candidate.declaredAccessibility === Accessibility.Public);
        if (member) return member;
      }
      return null;
    }
    /** True when a source class derived from `type` lists `contract` among its own interfaces. */
    isReimplementedBelow(type, contract) {
      const derivesFrom = candidate => {
        for (let current = candidate.baseType; current; current = current.baseType) if (current.equals(type)) return true;
        return false;
      };
      return this.program.sourceTypes.some(
        candidate => derivesFrom(candidate) && (candidate.interfaces ?? []).some(implemented => implemented.equals(contract)),
      );
    }
  };
