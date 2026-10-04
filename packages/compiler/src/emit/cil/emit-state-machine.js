/**
 * State machines, emission half (SF-A02-T30): what the `MoveNext` of every kind of state machine shares.
 *
 *   frame      the body was written for the kickoff: its parameters are fields of the machine, and the object it ran
 *              on is the field `<>4__this`
 *   states     a suspension point gets the next state number and a resume label; `MoveNext` starts with a `switch`
 *              on the state
 *   regions    a branch may enter a protected region only at its first instruction (ECMA-335 III.1.7.5), so a `try`
 *              with suspension points starts with a dispatch of its own; its finally block is skipped while the
 *              method is only leaving to suspend (the state is not negative then)
 *   hoisting   state-machine-hoisting.js, once the body is emitted
 */
import { CellLocation } from './locations.js';
import { isReference } from './type-facts.js';
import { slotsAcrossSuspensions, rewriteHoistedSlots } from './state-machine-hoisting.js';

const RUNNING = -1;

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
      this.resumeLabels = new Set();
      /** Slots that are written again after every resume point before they are read: they stay locals. */
      this.transientSlots = new Set();
      /** The dispatch being filled: `{first, labels, entry, parent}`. */
      this.dispatchScope = { first: 0, labels: [], entry: null, parent: null };
      return this.dispatchScope.labels;
    }
    /**
     * A new state that resumes at `resume`. Every enclosing dispatch learns where to send it: the innermost one to
     * the label itself, the others to the start of the protected region below them.
     * @returns {number} the state number
     */
    newState(resume) {
      const state = this.nextState++;
      let target = resume;
      for (let scope = this.dispatchScope; scope; scope = scope.parent) {
        scope.labels[state - scope.first] = target;
        target = scope.entry;
      }
      this.resumeLabels.add(resume);
      return state;
    }
    /** The body of a kickoff: the method the program declared only creates its state machine. */
    kickoffBody(machine) {
      return machine.kind === 'iterator' ? this.iteratorKickoff(machine) : this.asyncKickoff(machine);
    }
    loadState() {
      this.il.emit('ldarg', 0).emit('ldfld', this.machine.fields.state.token);
    }
    storeState(state) {
      this.il.emit('ldarg', 0).emit('ldc.i4', state).emit('stfld', this.machine.fields.state.token);
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
        scope = { first: this.nextState, labels: [], entry: il.newLabel(), parent: this.dispatchScope },
        optional = [],
        // Remembers the instructions `emit` adds, to drop them when the region turns out to have no suspension point.
        tentatively = emit => {
          const from = il.instructions.length;
          emit();
          optional.push(...il.instructions.slice(from));
        };
      const body = () => {
        tentatively(() => {
          this.loadState();
          il.emit('ldc.i4', scope.first).emit('sub').emit('switch', scope.labels);
        });
        this.dispatchScope = scope;
        try {
          emitBody();
        } finally {
          this.dispatchScope = scope.parent;
        }
      };
      const guardedFinally = () => {
        const suspending = il.newLabel();
        tentatively(() => {
          this.loadState();
          il.emit('ldc.i4', 0).emit('bge', suspending);
        });
        emitFinally();
        il.mark(suspending);
      };
      super.tryRegions(body, catches, emitFinally ? guardedFinally : null, scope.entry);
      if (!scope.labels.length) {
        const dropped = new Set(optional);
        il.instructions = il.instructions.filter(instruction => !dropped.has(instruction));
      }
      return undefined;
    }
    /** Moves the slots that live across a suspension into fields of the machine. */
    hoistLocals() {
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
      rewriteHoistedSlots(il, fields);
      return undefined;
    }
  };
