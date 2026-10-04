/**
 * An instruction stream that also knows the types on the evaluation stack (SF-A02-T30). An `await` suspends the
 * method with an empty stack, so the values that are on it - the operands of the expression around the await that
 * are already evaluated - must be saved first, and saving a value needs its type.
 *
 * The types come from two sources: the emitter records the type of every expression it has evaluated
 * (`recordTop`), and the instructions below say what they push. An entry of unknown type is `null`; an await over
 * one is refused rather than guessed.
 */
import { IlBuilder, stackEffectOf } from './il-builder.js';

/** Instructions whose result has one type whatever their operand: the name of that type on the core types. */
const constantTypes = Object.freeze({
  'ldc.i4': 'int',
  'ldc.i8': 'long',
  'ldc.r4': 'float',
  'ldc.r8': 'double',
  ldstr: 'string',
  ldnull: 'object',
  box: 'object',
});

export class TypedIlBuilder extends IlBuilder {
  /** @param core the CoreTypes of the compilation  @param {(object|null)[]} argumentTypes the type of each argument slot */
  constructor(core, argumentTypes) {
    super();
    this.core = core;
    this.argumentTypes = argumentTypes;
    /** One entry per stack slot, bottom first: a type symbol, or null when the type is not known. */
    this.stackTypes = [];
  }
  /** What an instruction pushes, when the instruction alone says it. */
  pushedBy(name, operand) {
    if (name === 'dup') return this.stackTypes.at(-1) ?? null;
    if (name === 'ldarg') return this.argumentTypes[operand] ?? null;
    if (name === 'ldloc') {
      const local = this.locals[operand];
      return local && !local.isByReference ? local.type : null;
    }
    const keyword = constantTypes[name];
    return keyword ? this.core[keyword] : null;
  }
  emit(name, operand, effect) {
    if (this.depth === null) return super.emit(name, operand, effect);
    const { pops, pushes } = stackEffectOf(name, effect),
      // `dup` pops one and pushes two: the value below stays what it was.
      pushed = this.pushedBy(name, operand),
      kept = name === 'dup' ? this.stackTypes.length : Math.max(0, this.stackTypes.length - pops);
    super.emit(name, operand, effect);
    this.stackTypes.length = kept;
    for (let count = name === 'dup' ? 1 : pushes; count > 0; count--) this.stackTypes.push(pushed);
    this.settle();
    return this;
  }
  mark(label, entryDepth) {
    super.mark(label, entryDepth);
    this.settle();
    return this;
  }
  /** Keeps one entry per stack slot; a slot that appears without an instruction saying what it is has no known type. */
  settle() {
    const depth = this.depth ?? 0;
    while (this.stackTypes.length < depth) this.stackTypes.push(null);
    if (this.depth !== null) this.stackTypes.length = depth;
  }
  /** Records the type of the value on top of the stack. */
  recordTop(type) {
    if (this.depth) this.stackTypes[this.depth - 1] = type;
  }
  /** The types of the values on the stack, bottom first; null entries are values of unknown type. */
  get pendingTypes() {
    return this.stackTypes.slice(0, this.depth ?? 0);
  }
}
