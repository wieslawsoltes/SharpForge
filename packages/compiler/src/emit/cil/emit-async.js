/**
 * Async methods (SF-A02-T30): the kickoff and the `MoveNext` of an async state machine (async-members.js), in the
 * shape Roslyn gives them.
 *
 *   kickoff     machine = new <M>d__N(); machine.<>t__builder = Builder.Create(); (receiver, arguments)
 *               machine.<>1__state = -1; machine.<>t__builder.Start(ref machine); return machine.<>t__builder.Task;
 *   MoveNext    try { switch (state) { n -> resume n }  body } catch (Exception e) { state = -2; SetException(e); return; }
 *               state = -2; SetResult(result);
 *   await e     awaiter = e.GetAwaiter();
 *               if (!awaiter.IsCompleted) { state = n; <>u__k = awaiter; AwaitUnsafeOnCompleted(ref awaiter, ref this);
 *                 return;  resume n: awaiter = <>u__k; <>u__k = default; state = -1; }
 *               awaiter.GetResult()
 *
 * The method suspends with an empty evaluation stack: the values on it when an await is reached are saved in
 * temporaries first and pushed again afterwards (il-stack-types.js knows their types), so operands evaluate once,
 * in the order they are written.
 */
import { walk } from '../../bound/semantic-walker.js';
import { TypedIlBuilder } from './il-stack-types.js';
import { AsyncBuilderMembers } from './async-builders.js';
import { awaiterOf } from './awaitables.js';
import { isReference, isVoid } from './type-facts.js';

const NOT_STARTED = -1;
const FINISHED = -2;
const nestedFunctions = new Set(['Lambda', 'LocalFunction']);
const variableTargets = new Set(['Local', 'Parameter']);
const awaitPresence = new WeakMap();

/** True when evaluating a node can suspend the method (an await in a nested function is that function's own). */
export function containsAwait(node) {
  let found = awaitPresence.get(node);
  if (found === undefined) {
    found = false;
    walk(node, child => {
      if (child.kind === 'Await' || child.isAwait) found = true;
      return !found && !nestedFunctions.has(child.kind);
    });
    awaitPresence.set(node, found);
  }
  return found;
}

/** True when a finally block of the body awaits: a `return` in its try block is completed after the suspension. */
function awaitsInFinally(body) {
  let found = false;
  walk(body, node => {
    if (node.kind === 'Try' && node.finallyBlock && containsAwait(node.finallyBlock)) found = true;
    if (node.isAwait && (node.kind === 'Using' || node.kind === 'LocalDeclaration')) found = true;
    return !found && !nestedFunctions.has(node.kind);
  });
  return found;
}

/** Class mixin: async methods. */
export const AsyncEmission = Base =>
  class extends Base {
    get isAsyncBody() {
      return this.machine?.kind === 'async' || this.machine?.kind === 'asyncIterator';
    }
    createInstructionStream(frame) {
      const machine = frame.stateMachine;
      if (machine?.kind !== 'async' && machine?.kind !== 'asyncIterator') return super.createInstructionStream(frame);
      return new TypedIlBuilder(this.core, [machine.type]);
    }
    expression(node) {
      if (!this.isAsyncBody) return super.expression(node);
      const il = this.il,
        before = il.depth,
        result = super.expression(node);
      if (before !== null && il.depth === before + 1 && node.type) il.recordTop(node.type);
      return result;
    }
    /** Pushes the address of the builder field of the machine in `MoveNext`. */
    pushBuilder() {
      this.il.emit('ldarg', 0).emit('ldflda', this.machine.fields.builder.token);
    }
    /** The body of the method the program declared: it creates the machine, starts it and returns its task. */
    asyncKickoff(machine) {
      const il = this.il,
        fields = machine.fields,
        members = new AsyncBuilderMembers(this.program, machine),
        instance = this.temp(machine.type);
      il.emit('newobj', machine.instanceConstructor.token, { pops: 0, pushes: 1 }).emit('stloc', instance);
      il.emit('ldloc', instance);
      members.create(il).emit('stfld', fields.builder.token);
      if (fields.receiver) {
        il.emit('ldloc', instance);
        this.pushFrameObject();
        if (!isReference(fields.receiver.type)) this.loadIndirect(fields.receiver.type);
        il.emit('stfld', fields.receiver.token);
      }
      for (const [parameter, { field }] of machine.parameters) {
        il.emit('ldloc', instance);
        this.ownParameterLocation(parameter).load();
        il.emit('stfld', field.token);
      }
      il.emit('ldloc', instance).emit('ldc.i4', NOT_STARTED).emit('stfld', fields.state.token);
      il.emit('ldloc', instance).emit('ldflda', fields.builder.token).emit('ldloca', instance);
      members.start(il);
      if (!machine.builder.taskType) return il.emit('ret', undefined, { pops: 0, pushes: 0 });
      il.emit('ldloc', instance).emit('ldflda', fields.builder.token);
      return members.task(il).emit('ret', undefined, { pops: 1, pushes: 0 });
    }
    /** @param bound the bound body of the kickoff  @returns the instruction stream of `MoveNext` */
    asyncMoveNext(bound) {
      const il = this.il,
        labels = this.beginStates(),
        tryStart = il.newLabel(),
        handlerStart = il.newLabel(),
        handlerEnd = il.newLabel(),
        exception = this.temp(this.core.exception),
        resultType = this.machine.builder.resultType;
      this.builderMembers = new AsyncBuilderMembers(this.program, this.machine);
      this.awaiterFields = new Map();
      this.completed = il.newLabel();
      this.suspended = il.newLabel();
      // The result is written just before the method completes, unless a finally block that awaits runs in between.
      this.resultSlot = !resultType ? null : awaitsInFinally(bound) ? this.temp(resultType) : this.transient(resultType);
      il.mark(tryStart);
      this.protect(() => {
        this.loadState();
        il.emit('switch', labels);
        this.enterBody();
        this.asyncBody(bound);
        if (il.isReachable) il.emit('leave', this.completed);
      });
      il.mark(handlerStart, 1);
      il.emit('stloc', exception);
      this.storeState(FINISHED);
      this.pushBuilder();
      il.emit('ldloc', exception);
      this.builderMembers.setException(il).emit('leave', this.suspended);
      il.mark(handlerEnd);
      il.addRegion({ kind: 'catch', tryStart, tryEnd: handlerStart, handlerStart, handlerEnd, catchType: this.tokens.type(this.core.exception) });
      il.mark(this.completed);
      this.storeState(FINISHED);
      this.pushBuilder();
      if (this.resultSlot !== null) il.emit('ldloc', this.resultSlot);
      this.builderMembers.setResult(il);
      il.mark(this.suspended);
      il.emit('ret', undefined, { pops: 0, pushes: 0 });
      this.hoistLocals();
      return il;
    }
    /** A block, or the expression of an expression-bodied lambda (its value is the result when the method has one). */
    asyncBody(bound) {
      if (bound.kind === 'Block') return this.statement(bound);
      const expression = bound.kind === 'ExpressionBody' ? bound.expression : bound;
      if (this.resultSlot === null) return this.effect(expression);
      this.expression(expression);
      return this.il.emit('stloc', this.resultSlot);
    }
    /** `return` completes the task: the value goes to the result slot and control to the `SetResult` call. */
    stmtReturn(node) {
      if (!this.isAsyncBody) return super.stmtReturn(node);
      if (node.expression) {
        if (this.resultSlot === null) this.effect(node.expression);
        else {
          this.expression(node.expression);
          this.il.emit('stloc', this.resultSlot);
        }
      }
      return this.jump(this.completed, 0);
    }
    /** A slot that is written again before it is read after every resume point: it never becomes a field. */
    transient(type) {
      const slot = this.temp(type);
      this.transientSlots.add(slot);
      return slot;
    }
    /** The field that keeps an awaiter of the given type across a suspension; one per awaiter type. */
    awaiterField(type) {
      let field = [...this.awaiterFields].find(([known]) => known.equals(type))?.[1];
      if (!field) {
        field = this.machine.lateField(this.program, `<>u__${this.awaiterFields.size + 1}`, type);
        this.awaiterFields.set(type, field);
      }
      return field;
    }
    /** Empties the evaluation stack into temporaries; returns their slots, bottom first. */
    savePending(syntax) {
      const types = this.il.pendingTypes;
      if (types.includes(null)) return this.unsupported('await while a value the emitter cannot save is on the evaluation stack', syntax);
      const slots = types.map(type => this.temp(type));
      for (let index = slots.length - 1; index >= 0; index--) this.il.emit('stloc', slots[index]);
      return slots;
    }
    /** Pushes the saved values back, below the result of the await when it has one. */
    restorePending(slots, resultType) {
      if (!slots.length) return;
      const il = this.il,
        result = isVoid(resultType) ? null : this.temp(resultType);
      if (result !== null) il.emit('stloc', result);
      for (const slot of slots) il.emit('ldloc', slot);
      if (result !== null) il.emit('ldloc', result);
    }
    exprAwait(node) {
      if (!this.isAsyncBody) return this.unsupported('await outside an async method', node.syntax);
      return this.awaitWith(awaiterOf(this, node), node.type, node.syntax);
    }
    /**
     * Awaits through an awaiter description (awaitables.js); the result, when there is one, is left on the stack.
     * @param awaiter `{awaiterType, isCritical, getAwaiter, isCompleted, getResult}`  @param resultType the type of the await
     */
    awaitWith(awaiter, resultType, syntax) {
      const il = this.il,
        saved = this.savePending(syntax),
        awaiterType = awaiter.awaiterType,
        isObject = isReference(awaiterType),
        slot = this.transient(awaiterType),
        pushAwaiter = () => il.emit(isObject ? 'ldloc' : 'ldloca', slot),
        completed = il.newLabel(),
        resume = il.newLabel(),
        field = this.awaiterField(awaiterType);
      this.selfSlot ??= this.transient(this.machine.type);
      awaiter.getAwaiter();
      il.emit('stloc', slot);
      pushAwaiter();
      awaiter.isCompleted();
      il.emit('brtrue', completed);
      this.storeState(this.newState(resume));
      il.emit('ldarg', 0).emit('ldloc', slot).emit('stfld', field.token);
      il.emit('ldarg', 0).emit('stloc', this.selfSlot);
      this.pushBuilder();
      il.emit('ldloca', slot).emit('ldloca', this.selfSlot);
      this.builderMembers.awaitOnCompleted(il, awaiterType, awaiter.isCritical);
      il.emit('leave', this.suspended);
      this.resumeAt(resume);
      il.emit('ldarg', 0).emit('ldfld', field.token).emit('stloc', slot);
      if (isObject) il.emit('ldarg', 0).emit('ldnull').emit('stfld', field.token);
      else il.emit('ldarg', 0).emit('ldflda', field.token).emit('initobj', this.tokens.type(awaiterType));
      il.mark(completed);
      pushAwaiter();
      awaiter.getResult();
      if (!isVoid(resultType)) il.recordTop(resultType);
      this.restorePending(saved, resultType);
      return undefined;
    }
    /** An assignment to a variable whose value awaits: the value first, then the store (the variable may be a field). */
    exprAssignment(node, isUsed) {
      if (!this.isAsyncBody || !variableTargets.has(node.left.kind) || !containsAwait(node.right)) return super.exprAssignment(node, isUsed);
      const value = this.temp(node.right.type ?? node.left.type),
        location = this.location(node.left);
      this.expression(node.right);
      this.il.emit('stloc', value);
      location.beginStore();
      this.il.emit('ldloc', value);
      return this.finishStore(location, isUsed);
    }
  };
