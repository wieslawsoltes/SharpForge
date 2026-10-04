/**
 * State machines, emission half (SF-A02-T30): what the `MoveNext` of every kind of state machine shares.
 *
 *   frame      the body was written for the kickoff: its parameters are fields of the machine, and the object it ran
 *              on is the field `<>4__this`
 *   states     a suspension point gets the next state number and a resume label; `MoveNext` starts with a `switch`
 *              on the state. An async iterator suspends in two ways, so it has two series: 0, 1, ... at an await
 *              and -4, -5, ... at a `yield return` (Roslyn's numbering: -1 running, -2 finished, -3 not started)
 *   regions    a branch may enter a protected region only at its first instruction (ECMA-335 III.1.7.5), so a `try`
 *              with suspension points starts with a dispatch of its own; its finally block is skipped while the
 *              method is only leaving to suspend (it is not in the running state then)
 *   hoisting   state-machine-hoisting.js, once the body is emitted
 */
import { CellLocation } from './locations.js';
import { isReference } from './type-facts.js';
import { slotsAcrossSuspensions, rewriteHoistedSlots } from './state-machine-hoisting.js';

const RUNNING = -1;
/** The state of the first `yield return` of an async iterator; the next ones count down. */
const FIRST_YIELD = -4;

/** Class mixin: state machines. */
export const StateMachineEmission = Base =>
  class extends Base {
    /** The state machine whose `MoveNext` this is, or null in an ordinary method. */
    get machine() {
      return this.frame.stateMachine ?? null;
    }
    /**
     * Starts the bookkeeping of suspension points; state 0 is the first one handed out.
     * @returns {object[]} the labels of the `switch` that starts `MoveNext`, filled as states are created
     */
    beginStates() {
      this.nextState = 0;
      this.nextYield = 0;
      this.resumeLabels = new Set();
      /** Slots that are written again after every resume point before they are read: they stay locals. */
      this.transientSlots = new Set();
      /** The dispatch being filled: `{first, labels, firstYield, yieldLabels, entry, parent}`. */
      this.dispatchScope = this.newDispatchScope(null, null);
      this.cacheState();
      return this.dispatchScope.labels;
    }
    /**
     * `MoveNext` keeps the state in a local as well (Roslyn's cached state): the guard of a finally block reads the
     * local, because once the awaiter has the continuation another thread may resume the machine and write the
     * field before this call has left its protected regions.
     */
    cacheState() {
      const il = this.il,
        from = il.instructions.length;
      this.stateCache = { instructions: [], isRead: false };
      // An iterator runs on the thread that calls MoveNext: nothing writes its state behind its back.
      this.stateSlot = null;
      if (this.machine.kind === 'iterator') return;
      this.stateSlot = this.temp(this.core.int);
      this.transientSlots.add(this.stateSlot);
      this.loadState();
      il.emit('stloc', this.stateSlot);
      /** The instructions that keep the cache, dropped when no finally block has a guard (`dropUnusedStateCache`). */
      this.stateCache = { instructions: il.instructions.slice(from), isRead: false };
    }
    /** A machine without a guarded finally block does not read the cached state: it is not kept. */
    dropUnusedStateCache() {
      if (this.stateCache.isRead) return;
      const dropped = new Set(this.stateCache.instructions);
      this.il.instructions = this.il.instructions.filter(instruction => !dropped.has(instruction));
    }
    newDispatchScope(entry, parent) {
      return { first: this.nextState, labels: [], firstYield: this.nextYield, yieldLabels: [], entry, parent };
    }
    /**
     * A new state that resumes at `resume`. Every enclosing dispatch learns where to send it: the innermost one to
     * the label itself, the others to the start of the protected region below them.
     * @param {{inYieldSeries?: boolean}} [options] the `yield return` of an async iterator
     * @returns {number} the state number
     */
    newState(resume, { inYieldSeries = false } = {}) {
      const ordinal = inYieldSeries ? this.nextYield++ : this.nextState++;
      let target = resume;
      for (let scope = this.dispatchScope; scope; scope = scope.parent) {
        if (inYieldSeries) scope.yieldLabels[ordinal - scope.firstYield] = target;
        else scope.labels[ordinal - scope.first] = target;
        target = scope.entry;
      }
      this.resumeLabels.add(resume);
      return inYieldSeries ? FIRST_YIELD - ordinal : ordinal;
    }
    /**
     * Emits the dispatch of a scope: one `switch` per series of states.
     * @returns {object[][]} the instructions of each `switch`, for `dropUnusedDispatch`
     */
    emitDispatch(scope) {
      const il = this.il,
        emitted = emit => {
          const from = il.instructions.length;
          emit();
          return il.instructions.slice(from);
        };
      return [
        {
          labels: scope.labels,
          instructions: emitted(() => {
            this.loadState();
            il.emit('ldc.i4', scope.first).emit('sub').emit('switch', scope.labels);
          }),
        },
        {
          labels: scope.yieldLabels,
          instructions: emitted(() => {
            il.emit('ldc.i4', FIRST_YIELD - scope.firstYield);
            this.loadState();
            il.emit('sub').emit('switch', scope.yieldLabels);
          }),
        },
      ];
    }
    /** Removes the instructions of every `switch` of a dispatch that no state was created for. */
    dropUnusedDispatch(dispatch, extra = []) {
      const unused = dispatch.filter(entry => !entry.labels.length).flatMap(entry => entry.instructions),
        dropped = new Set(dispatch.every(entry => !entry.labels.length) ? [...unused, ...extra] : unused);
      if (dropped.size) this.il.instructions = this.il.instructions.filter(instruction => !dropped.has(instruction));
    }
    /** The body of a kickoff: the method the program declared only creates its state machine. */
    kickoffBody(machine) {
      this.debug?.kickoff(machine);
      if (machine.kind === 'asyncIterator') return this.asyncIteratorKickoff(machine);
      return machine.kind === 'iterator' ? this.iteratorKickoff(machine) : this.asyncKickoff(machine);
    }
    loadState() {
      this.il.emit('ldarg', 0).emit('ldfld', this.machine.fields.state.token);
    }
    storeState(state) {
      const il = this.il,
        from = il.instructions.length + 2;
      il.emit('ldarg', 0).emit('ldc.i4', state);
      if (this.stateSlot !== null) il.emit('dup').emit('stloc', this.stateSlot);
      this.stateCache.instructions.push(...il.instructions.slice(from));
      il.emit('stfld', this.machine.fields.state.token);
    }
    /** Marks the point a suspended method continues at; it is running again. */
    resumeAt(label) {
      this.il.mark(label, 0);
      this.storeState(RUNNING);
    }
    pushFrameObject() {
      const machine = this.machine;
      if (!machine) return super.pushFrameObject();
      const receiver = machine.fields.receiver;
      if (!receiver) return this.unsupported('this in a static context');
      // A struct receiver was copied into the machine; its members are reached through the address of the copy.
      return this.il.emit('ldarg', 0).emit(isReference(receiver.type) ? 'ldfld' : 'ldflda', receiver.token);
    }
    ownParameterLocation(parameter, syntax) {
      const parameters = this.machine?.parameters,
        entry = parameters?.get(parameter) ?? parameters?.get(parameter.originalDefinition);
      if (!entry) return super.ownParameterLocation(parameter, syntax);
      return new CellLocation(this, () => this.il.emit('ldarg', 0), entry.field.token, parameter.type);
    }
    tryRegions(emitBody, catches, emitFinally, start) {
      if (!this.machine) return super.tryRegions(emitBody, catches, emitFinally, start);
      const il = this.il,
        scope = this.newDispatchScope(il.newLabel(), this.dispatchScope),
        // The guard of the finally block: dropped with the dispatch when the region has no suspension point.
        guard = [];
      let dispatch = [];
      const body = () => {
        dispatch = this.emitDispatch(scope);
        this.dispatchScope = scope;
        try {
          emitBody();
        } finally {
          this.dispatchScope = scope.parent;
        }
      };
      const guardedFinally = () => {
        const suspending = il.newLabel(),
          from = il.instructions.length;
        this.stateCache.isRead = true;
        if (this.stateSlot === null) this.loadState();
        else il.emit('ldloc', this.stateSlot);
        il.emit('ldc.i4', RUNNING).emit('bne.un', suspending);
        guard.push(...il.instructions.slice(from));
        emitFinally();
        il.mark(suspending);
      };
      super.tryRegions(body, catches, emitFinally ? guardedFinally : null, scope.entry);
      this.dropUnusedDispatch(dispatch, guard);
      return undefined;
    }
    /** Moves the slots that live across a suspension into fields of the machine. */
    hoistLocals() {
      this.dropUnusedStateCache();
      const il = this.il,
        machine = this.machine,
        names = new Map([...this.slots].map(([local, slot]) => [slot, local.name])),
        fields = new Map();
      for (const slot of [...slotsAcrossSuspensions(il, this.resumeLabels)].sort((left, right) => left - right)) {
        if (this.transientSlots.has(slot)) continue;
        const { type, isByReference } = il.locals[slot];
        if (isByReference) return this.unsupported('a by-reference local that lives across a suspension point');
        const ordinal = ++machine.hoistedCount,
          name = names.has(slot) ? `<${names.get(slot)}>5__${ordinal}` : `<>7__wrap${ordinal}`;
        fields.set(slot, machine.lateField(this.program, name, type).token);
      }
      this.debug?.hoistLocals(fields);
      rewriteHoistedSlots(il, fields);
      return undefined;
    }
  };
