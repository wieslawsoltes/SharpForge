/**
 * The instruction stream of one method body (SF-A02-T30): instructions with symbolic branch targets, the local
 * variable list and the protected regions. `assemble` encodes it through the public `CilWriter` of `@sharpforge/cil`
 * (branches are relaxed to their short forms there) and returns what `writeMethodBody` takes.
 *
 * Eager stack tracking checks emitter invariants. The completed, relaxed stream is analyzed through the public
 * CIL graph solver for its exact header bound, including instructions inserted after the initial emission.
 */
import { CilOpcodes, CilWriter, fixedStackEffect, analyzeMaxStack } from '@sharpforge/cil';

const EXCEPTION_FLAGS = Object.freeze({ catch: 0, filter: 1, finally: 2, fault: 4 });
/**
 * How many values an instruction pops and pushes.
 * @param {{pops: number, pushes: number}} [effect] required for an instruction whose effect depends on its operand
 * @returns {{pops?: number, pushes?: number}} empty when the effect is needed and was not given
 */
export function stackEffectOf(name, effect) {
  return effect ?? fixedStackEffect(name) ?? {};
}

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
    this.debug = null;
    this.labelCount = 0;
    /** Current stack depth, or null after an instruction that does not fall through: what follows cannot run. */
    this.depth = 0;
    this.maxDepth = 0;
  }
  /** A branch target that `mark` places later (or earlier, for a loop). */
  newLabel() {
    return { id: this.labelCount++, depth: undefined, marked: false };
  }
  /**
   * Places a label before the next instruction. After an instruction that does not fall through, the code at a label
   * is reachable only when a branch has targeted it or `entryDepth` is given; otherwise it stays unreachable.
   * @param {number} [entryDepth] the stack depth on entry when control arrives in a way the stream does not show: 1
   *   at a catch handler, 0 at a finally handler, at a loop body entered from its test and at a source label
   */
  mark(label, entryDepth) {
    if (label.marked) throw new IlBuilderError('IL label marked twice');
    label.marked = true;
    if (entryDepth !== undefined) label.depth = entryDepth;
    if (this.depth === null) this.depth = label.depth ?? null;
    else if (label.depth === undefined) label.depth = this.depth;
    else if (label.depth !== this.depth) throw new IlBuilderError(`Stack depth ${this.depth} meets ${label.depth} at a label`);
    if (this.depth !== null) this.maxDepth = Math.max(this.maxDepth, this.depth);
    this.instructions.push({ label });
    return this;
  }
  /** The position of the next instruction in the stream, for `insert`. */
  get position() {
    return this.instructions.length;
  }
  /**
   * Inserts stack-neutral instructions at an earlier position (the reset of a flag that code emitted afterwards
   * turned out to need). @param {{name: string, operand?: any}[]} instructions each pushes at most one value
   */
  insert(position, instructions) {
    this.instructions.splice(position, 0, ...instructions);
    this.maxDepth += 1;
  }
  /** True when a label was placed here: a branch to it lands on the next instruction. */
  get isJustPastLabel() {
    for (let index = this.instructions.length - 1; index >= 0; index--) {
      const instruction = this.instructions[index];
      if (!instruction.debugMarker) return instruction.label !== undefined;
    }
    return false;
  }
  /** Records a source/scope boundary without changing reachability, stack state or emitted code. */
  markDebug(marker) {
    this.instructions.push({ debugMarker: marker });
  }
  /** True when the next instruction can be reached by falling through. */
  get isReachable() {
    return this.depth !== null;
  }
  /**
   * Adds an instruction. Unreachable code is not emitted: an instruction after one that does not fall through is
   * dropped until a reachable label is marked (the stream must end in a transfer, and .NET rejects a body that does not).
   * @param {string} name the opcode name  @param [operand] a number, a label, a list of labels (switch) or a bigint
   * @param {{pops: number, pushes: number}} [effect] required for `call`, `callvirt`, `newobj`, `calli` and `ret`
   */
  emit(name, operand, effect) {
    const opcode = CilOpcodes[name];
    if (!opcode) throw new IlBuilderError(`Unknown CIL opcode '${name}'`);
    const { pops, pushes } = stackEffectOf(name, effect);
    if (pops === undefined) throw new IlBuilderError(`'${name}' needs its stack effect`);
    if (this.depth === null) return this;
    if (this.depth < pops) throw new IlBuilderError(`'${name}' pops ${pops} from a stack of ${this.depth}`);
    this.depth = this.depth - pops + pushes;
    this.maxDepth = Math.max(this.maxDepth, this.depth);
    this.instructions.push({ name, operand, effect: fixedStackEffect(name) ? null : { pops, pushes } });
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
      debugOffsets = this.debug ? new Map() : null,
      variableEffects = new Map(),
      nameOf = label => 'L' + label.id;
    for (const instruction of this.instructions) {
      if (instruction.debugMarker) debugOffsets?.set(instruction.debugMarker, writer.length);
      else if (instruction.label) {
        writer.mark(nameOf(instruction.label));
        debugOffsets?.set(instruction.label, writer.length);
      }
      else {
        if (instruction.effect) variableEffects.set(writer.length, instruction.effect);
        encode(writer, instruction, nameOf);
      }
    }
    const original = new Map(writer.labels),
      { code, offsetMap } = writer.finishWithLayout(),
      offsetOf = label => {
        const offset = offsetMap.get(original.get(nameOf(label)));
        if (offset === undefined) throw new IlBuilderError('A protected region ends at an unmarked label');
        return offset;
      };
    // A region whose protected code was unreachable has no extent; it protects nothing.
    const handlers = this.regions.filter(region => offsetOf(region.tryStart) !== offsetOf(region.tryEnd)).map(region => ({
      flags: EXCEPTION_FLAGS[region.kind],
      start: offsetOf(region.tryStart),
      end: offsetOf(region.tryEnd),
      target: offsetOf(region.handlerStart),
      handlerEnd: offsetOf(region.handlerEnd),
      ...(region.kind === 'catch' ? { catchType: region.catchType } : {}),
      ...(region.kind === 'filter' ? { filterOffset: offsetOf(region.filterStart) } : {}),
    }));
    if (debugOffsets) for (const [marker, offset] of debugOffsets) debugOffsets.set(marker, offsetMap.get(offset));
    const finalEffects = new Map();
    for (const [offset, effect] of variableEffects) finalEffects.set(offsetMap.get(offset), effect);
    const analysis = analyzeMaxStack(code, { handlers,
      resolveStackEffect: instruction => finalEffects.get(instruction.opcodeOffset) });
    if (analysis.status !== 'complete') throw new IlBuilderError(analysis.diagnostics.map(item => item.message).join('; '));
    return { code, maxStack: analysis.maxStack, handlers, debugOffsets,
      hasDynamicStackAllocation: analysis.hasDynamicStackAllocation };
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
