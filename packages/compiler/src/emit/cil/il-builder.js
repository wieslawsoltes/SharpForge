/**
 * The instruction stream of one method body (SF-A02-T30): instructions with symbolic branch targets, the local
 * variable list and the protected regions. `assemble` encodes it through the public `CilWriter` of `@sharpforge/cil`
 * (branches are relaxed to their short forms there) and returns what `writeMethodBody` takes.
 *
 * The evaluation stack depth is tracked while instructions are added, so the header's maxstack is exact for the
 * code that was emitted and an emitter that leaves the stack unbalanced fails here instead of producing bad IL.
 */
import { CilOpcodes, CilWriter } from '@sharpforge/cil';

const EXCEPTION_FLAGS = Object.freeze({ catch: 0, filter: 1, finally: 2, fault: 4 });
const variableCount = /^Var/;

/** How many values a fixed stack behaviour (`Pop1_pop1`, `Pushi`, ...) names. */
function countOf(behaviour) {
  return behaviour.endsWith('0') ? 0 : behaviour.split('_').length;
}

const fixedEffects = new Map(
  Object.values(CilOpcodes).map(opcode => [
    opcode.name,
    variableCount.test(opcode.stackBehaviourPop) || variableCount.test(opcode.stackBehaviourPush)
      ? null
      : { pops: countOf(opcode.stackBehaviourPop), pushes: countOf(opcode.stackBehaviourPush) },
  ]),
);
const leavesStackEmpty = new Set(['leave', 'throw', 'rethrow', 'endfinally', 'endfilter']);
const endsFlow = new Set(['Branch', 'Return', 'Throw']);

/** An invariant of the emitter was broken; this is a compiler defect, never a property of the program. */
export class IlBuilderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IlBuilderError';
  }
}

export class IlBuilder {
  constructor() {
    this.instructions = [];
    this.locals = [];
    this.regions = [];
    this.labelCount = 0;
    /** Current stack depth, or null after an instruction that does not fall through. */
    this.depth = 0;
    this.maxDepth = 0;
    /** True between an instruction that does not fall through and the next label: that code cannot run. */
    this.isDead = false;
  }
  /** A branch target that `mark` places later (or earlier, for a loop). */
  newLabel() {
    return { id: this.labelCount++, depth: undefined, marked: false };
  }
  /**
   * Places a label before the next instruction.
   * @param {number} [entryDepth] the stack depth on entry when control only arrives from outside the instruction
   *   stream (1 at a catch handler, 0 at a finally handler)
   */
  mark(label, entryDepth) {
    if (label.marked) throw new IlBuilderError('IL label marked twice');
    label.marked = true;
    if (entryDepth !== undefined) label.depth = entryDepth;
    if (this.depth === null || this.isDead) this.depth = label.depth ?? 0;
    else if (label.depth === undefined) label.depth = this.depth;
    else if (label.depth !== this.depth) throw new IlBuilderError(`Stack depth ${this.depth} meets ${label.depth} at a label`);
    this.isDead = false;
    this.maxDepth = Math.max(this.maxDepth, this.depth);
    this.instructions.push({ label });
    return this;
  }
  /** True when the next instruction can be reached by falling through. */
  get isReachable() {
    return this.depth !== null && !this.isDead;
  }
  /**
   * Adds an instruction.
   * @param {string} name the opcode name  @param [operand] a number, a label, a list of labels (switch) or a bigint
   * @param {{pops: number, pushes: number}} [effect] required for `call`, `callvirt`, `newobj`, `calli` and `ret`
   */
  emit(name, operand, effect) {
    const opcode = CilOpcodes[name];
    if (!opcode) throw new IlBuilderError(`Unknown CIL opcode '${name}'`);
    const { pops, pushes } = effect ?? fixedEffects.get(name) ?? {};
    if (pops === undefined) throw new IlBuilderError(`'${name}' needs its stack effect`);
    // Code after an unconditional transfer is unreachable until a label is marked. It is still encoded, but its stack
    // is not tracked: the value an abandoned expression would have produced is simply assumed.
    if (this.depth === null) {
      this.depth = 0;
      this.isDead = true;
    }
    if (this.isDead) this.depth = Math.max(this.depth, pops);
    if (this.depth < pops) throw new IlBuilderError(`'${name}' pops ${pops} from a stack of ${this.depth}`);
    this.depth = this.depth - pops + pushes;
    this.instructions.push({ name, operand });
    if (this.isDead) return this;
    this.maxDepth = Math.max(this.maxDepth, this.depth);
    if (leavesStackEmpty.has(name)) this.depth = 0;
    for (const target of branchTargets(opcode, operand)) this.reach(target, name);
    if (endsFlow.has(opcode.flowControl)) this.depth = null;
    return this;
  }
  reach(label, name) {
    if (label.depth === undefined) label.depth = this.depth;
    else if (label.depth !== this.depth) throw new IlBuilderError(`'${name}' reaches a label at depth ${this.depth}, expected ${label.depth}`);
  }
  /**
   * Declares a local variable slot.
   * @param type a type symbol  @param {{isByReference?: boolean, isPinned?: boolean}} [options]
   * @returns {number} the slot index
   */
  declareLocal(type, options = {}) {
    this.locals.push({ type, isByReference: !!options.isByReference, isPinned: !!options.isPinned });
    return this.locals.length - 1;
  }
  /**
   * Records a protected region; every bound is a marked label.
   * @param {{kind: 'catch'|'filter'|'finally'|'fault', tryStart, tryEnd, handlerStart, handlerEnd, catchType?: number,
   *   filterStart?}} region `catchType` is a TypeDefOrRef token
   */
  addRegion(region) {
    this.regions.push(region);
  }
  /**
   * Encodes the stream.
   * @returns {{code: Uint8Array, maxStack: number, handlers: object[]}} `handlers` are exception clauses in the
   *   order they were added (inner regions first, as ECMA-335 II.25.4.6 requires)
   */
  assemble() {
    const writer = new CilWriter(undefined, { compact: true }),
      nameOf = label => 'L' + label.id;
    for (const instruction of this.instructions) {
      if (instruction.label) writer.mark(nameOf(instruction.label));
      else encode(writer, instruction, nameOf);
    }
    const original = new Map(writer.labels),
      { code, offsetMap } = writer.finishWithLayout(),
      offsetOf = label => {
        const offset = offsetMap.get(original.get(nameOf(label)));
        if (offset === undefined) throw new IlBuilderError('A protected region ends at an unmarked label');
        return offset;
      };
    const handlers = this.regions.map(region => ({
      flags: EXCEPTION_FLAGS[region.kind],
      start: offsetOf(region.tryStart),
      end: offsetOf(region.tryEnd),
      target: offsetOf(region.handlerStart),
      handlerEnd: offsetOf(region.handlerEnd),
      ...(region.kind === 'catch' ? { catchType: region.catchType } : {}),
      ...(region.kind === 'filter' ? { filterOffset: offsetOf(region.filterStart) } : {}),
    }));
    return { code, maxStack: this.maxDepth, handlers };
  }
}

function branchTargets(opcode, operand) {
  if (opcode.operand === 'switch') return operand;
  return opcode.operand === 'br32' || opcode.operand === 'br8' ? [operand] : [];
}

const slotInstructions = new Set(['ldarg', 'ldarga', 'starg', 'ldloc', 'ldloca', 'stloc']);

function encode(writer, { name, operand }, nameOf) {
  const opcode = CilOpcodes[name];
  if (slotInstructions.has(name)) writer.local(name, operand);
  else if (name === 'ldc.i4') writer.integer(operand);
  else if (opcode.operand === 'switch') writer.op(name, operand.map(nameOf));
  else if (opcode.operand === 'br32') writer.op(name, nameOf(operand));
  else writer.op(name, operand);
}
