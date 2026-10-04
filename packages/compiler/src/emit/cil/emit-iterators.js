/**
 * Iterators (SF-A02-T30): the `MoveNext` of an iterator class (iterator-members.js) and `yield`.
 *
 *   switch (state) { 0 -> start, n -> after the n-th yield }  return false;
 *   start:   state = -1; body
 *   yield return v:  current = v; state = n; return true;  resume n: state = -1; [if (disposeMode) goto finished;]
 *   yield break, the end of the body:  finished: return false;
 *
 * A `yield return` inside a protected region leaves it to suspend; the finally blocks around it then skip themselves
 * (emit-state-machine.js). They run when the body leaves the region - normally, by an exception, or because Dispose
 * resumed the method in dispose mode.
 */
import { isReference } from './type-facts.js';

const NOT_ENUMERATING = -2;
const BEFORE_FIRST = 0;
const RUNNING = -1;
const returnsValue = { pops: 1, pushes: 0 };

/** Class mixin: iterators. */
export const IteratorEmission = Base =>
  class extends Base {
    /**
     * The body of the method the program declared: it creates the iterator object and hands it the object the method
     * runs on and the arguments. An enumerable keeps the arguments for the enumerators it will create.
     */
    iteratorKickoff(machine) {
      const il = this.il,
        receiver = machine.fields.receiver,
        initialState = machine.shape.isEnumerable ? NOT_ENUMERATING : BEFORE_FIRST;
      il.emit('ldc.i4', initialState).emit('newobj', machine.instanceConstructor.token, { pops: 1, pushes: 1 });
      if (receiver) {
        il.emit('dup');
        this.pushFrameObject();
        if (!isReference(receiver.type)) this.loadIndirect(receiver.type);
        il.emit('stfld', receiver.token);
      }
      for (const [parameter, { field, initial }] of machine.parameters) {
        il.emit('dup');
        this.ownParameterLocation(parameter).load();
        il.emit('stfld', (initial ?? field).token);
      }
      return il.emit('ret', undefined, returnsValue);
    }
    /** @param bound the bound body of the kickoff  @returns the instruction stream of `MoveNext` */
    iteratorMoveNext(bound) {
      const il = this.il,
        start = il.newLabel(),
        labels = this.beginStates();
      this.finished = il.newLabel();
      this.suspended = il.newLabel();
      this.loadState();
      il.emit('switch', labels).emit('br', this.finished);
      if (this.newState(start) !== BEFORE_FIRST) return this.unsupported('an iterator whose first state is not 0');
      il.mark(start, 0);
      this.storeState(RUNNING);
      this.enterBody();
      this.statement(bound);
      il.mark(this.finished);
      il.emit('ldc.i4', 0).emit('ret', undefined, returnsValue);
      il.mark(this.suspended);
      il.emit('ldc.i4', 1).emit('ret', undefined, returnsValue);
      this.hoistLocals();
      return il;
    }
    stmtYieldReturn(node) {
      const il = this.il,
        fields = this.machine.fields,
        resume = il.newLabel();
      il.emit('ldarg', 0);
      this.expression(node.expression);
      il.emit('stfld', fields.current.token);
      this.storeState(this.newState(resume));
      if (this.protectedDepth) il.emit('leave', this.suspended);
      else il.emit('ldc.i4', 1).emit('ret', undefined, returnsValue);
      this.resumeAt(resume);
      if (!fields.disposeMode) return;
      const proceed = il.newLabel();
      il.emit('ldarg', 0).emit('ldfld', fields.disposeMode.token).emit('brfalse', proceed);
      this.jump(this.finished, 0);
      il.mark(proceed);
    }
    stmtYieldBreak() {
      this.jump(this.finished, 0);
    }
  };
