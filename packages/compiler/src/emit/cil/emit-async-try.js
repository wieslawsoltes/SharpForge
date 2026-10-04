/**
 * `await` inside `catch` and `finally` (SF-A02-T30). A method cannot suspend inside a handler - control leaves a
 * handler only by ending it - so a handler that awaits is rewritten, as Roslyn rewrites it:
 *
 *   try { body } catch (T e) { handler }        int taken = 0;
 *                                               try { body } catch (T e) { taken = 1; }
 *                                               if (taken == 1) { handler }
 *
 *   try { body } finally { handler }            object pending = null; int branch = 0;
 *                                               try { body } catch (object e) { pending = e; }
 *                                               handler
 *                                               if (pending != null) rethrow pending;
 *                                               switch (branch) { the jump that left the body }
 *
 * A `throw;` in a moved catch block, and the rethrow after a moved finally block, go through
 * `ExceptionDispatchInfo.Capture(e).Throw()`, which keeps the stack trace of the original throw. A jump out of the
 * body of a try with a moved finally block (`return`, `break`, `continue`) is recorded and made after the block.
 */
import { frameworkType } from './framework-types.js';
import { containsAwait } from './emit-async.js';

const EXCEPTION_SERVICES = 'System.Runtime.ExceptionServices';

/** A catch clause whose handler only records that it was taken; `ordinal` is what it stores. */
const recording = (clause, ordinal, local) => ({ ...clause, local, block: null, recordsOrdinal: ordinal });

/** Class mixin: await in catch and finally blocks. */
export const AsyncTryEmission = Base =>
  class extends Base {
    stmtTry(node) {
      const catches = node.catches ?? [],
        awaitsInFinally = this.isAsyncBody && !!node.finallyBlock && containsAwait(node.finallyBlock),
        awaitsInCatch = this.isAsyncBody && catches.some(clause => containsAwait(clause.block));
      if (!awaitsInFinally && !awaitsInCatch) return super.stmtTry(node);
      if (awaitsInFinally) return this.tryWithMovedFinally(node, awaitsInCatch);
      if (!node.finallyBlock) return this.tryWithMovedCatches(node);
      return this.tryRegions(
        () => this.tryWithMovedCatches(node),
        [],
        () => this.statement(node.finallyBlock),
      );
    }
    /** A local the program did not declare: the emitter gives it a slot like any other. */
    synthesizedLocal(name, type) {
      return { name, type };
    }
    /** The catch clauses record which of them was taken; their blocks run after the try statement. */
    tryWithMovedCatches(node) {
      const il = this.il,
        taken = this.temp(this.core.int),
        end = il.newLabel(),
        clauses = node.catches.map((clause, index) => {
          const local = clause.local ?? this.synthesizedLocal('<>s__caught', clause.type ?? this.core.object);
          return recording(clause, index + 1, local);
        });
      this.takenSlots ??= new Map();
      for (const clause of clauses) this.takenSlots.set(clause, taken);
      il.emit('ldc.i4', 0).emit('stloc', taken);
      this.tryRegions(() => this.statement(node.body), clauses, null);
      node.catches.forEach((clause, index) => {
        const next = il.newLabel(),
          outer = this.rethrowSource;
        il.emit('ldloc', taken).emit('ldc.i4', index + 1).emit('bne.un', next);
        this.rethrowSource = clauses[index].local;
        try {
          this.statement(clause.block);
        } finally {
          this.rethrowSource = outer;
        }
        if (il.isReachable) il.emit(this.protectedDepth ? 'leave' : 'br', end);
        il.mark(next);
      });
      il.mark(end);
    }
    /** The handler of a clause: a recording clause stores its ordinal; an ordinary one hides the outer rethrow source. */
    catchBlock(clause) {
      if (clause.recordsOrdinal) return this.il.emit('ldc.i4', clause.recordsOrdinal).emit('stloc', this.takenSlots.get(clause));
      if (clause.recordsOrdinal === 0) return undefined;
      const outer = this.rethrowSource;
      this.rethrowSource = null;
      try {
        return super.catchBlock(clause);
      } finally {
        this.rethrowSource = outer;
      }
    }
    /** `ExceptionDispatchInfo.Capture(exception).Throw()` for the exception on the stack. */
    rethrowCaptured() {
      const il = this.il,
        core = this.core,
        info = frameworkType(core, EXCEPTION_SERVICES, 'ExceptionDispatchInfo'),
        capture = { isStatic: true, returnType: info, parameters: [{ type: core.exception }] },
        raise = { isStatic: false, returnType: core.void, parameters: [] };
      il.emit('call', this.tokens.external(info, 'Capture', capture), { pops: 1, pushes: 1 });
      il.emit('callvirt', this.tokens.external(info, 'Throw', raise), { pops: 1, pushes: 0 });
      // `Throw` does not return; the stream says so, as the flow analysis of the program does.
      il.emit('ldnull').emit('throw');
    }
    stmtThrow(node) {
      if (node.expression || !this.rethrowSource) return super.stmtThrow(node);
      this.localLocation(this.rethrowSource).load();
      return this.rethrowCaptured();
    }
    /** The finally block runs after the try statement, whichever way the body was left. */
    tryWithMovedFinally(node, awaitsInCatch) {
      const il = this.il,
        core = this.core,
        pending = this.synthesizedLocal('<>s__pending', core.object),
        frame = { depthOutside: this.protectedDepth, branchSlot: this.temp(core.int), branches: [], after: il.newLabel() },
        proceed = il.newLabel(),
        isException = il.newLabel(),
        body = () => {
          if (awaitsInCatch) return this.tryWithMovedCatches(node);
          if (node.catches?.length) return this.tryRegions(() => this.statement(node.body), node.catches, null);
          return this.statement(node.body);
        };
      il.emit('ldnull').emit('stloc', this.slotOf(pending)).emit('ldc.i4', 0).emit('stloc', frame.branchSlot);
      this.movedFinallyFrames ??= [];
      this.movedFinallyFrames.push(frame);
      try {
        this.tryRegions(body, [{ type: core.object, local: pending, block: null, recordsOrdinal: 0 }], null);
      } finally {
        this.movedFinallyFrames.pop();
      }
      il.mark(frame.after);
      this.statement(node.finallyBlock);
      if (!il.isReachable) return;
      il.emit('ldloc', this.slotOf(pending)).emit('brfalse', proceed);
      il.emit('ldloc', this.slotOf(pending)).emit('isinst', this.tokens.type(core.exception)).emit('dup').emit('brtrue', isException);
      il.emit('pop').emit('ldloc', this.slotOf(pending)).emit('throw');
      il.mark(isException);
      this.rethrowCaptured();
      il.mark(proceed);
      frame.branches.forEach((branch, index) => {
        const next = il.newLabel();
        il.emit('ldloc', frame.branchSlot).emit('ldc.i4', index + 1).emit('bne.un', next);
        this.jump(branch.label, branch.protectedDepth);
        il.mark(next);
      });
    }
    /** A jump that leaves the body of a try with a moved finally block is made after that block. */
    jump(label, protectedDepthAtTarget) {
      const frame = this.movedFinallyFrames?.at(-1);
      if (!frame || protectedDepthAtTarget > frame.depthOutside) return super.jump(label, protectedDepthAtTarget);
      let index = frame.branches.findIndex(branch => branch.label === label);
      if (index < 0) index = frame.branches.push({ label, protectedDepth: protectedDepthAtTarget }) - 1;
      return this.il.emit('ldc.i4', index + 1).emit('stloc', frame.branchSlot).emit('leave', frame.after);
    }
    stmtGoto(node) {
      if (node.label && this.movedFinallyFrames?.length) return this.unsupported('goto inside a try whose finally block awaits', node.syntax);
      return super.stmtGoto(node);
    }
  };
