import { Writer, CilError } from '../binary.js';
import { opcodeByName } from './catalog.js';
import { emitLocal, emitInteger } from './compact.js';
import { finishCilLayout } from '../il-layout.js';
import { emitInstructionGroup } from '../il-prefixes.js';

/** Byte-oriented CIL writer. Optional compact helpers select encodings before offsets are observed. */
export class CilWriter extends Writer {
  constructor(capacity, { compact = false } = {}) {
    super(capacity);
    if (typeof compact !== 'boolean') throw new CilError('Invalid compact instruction option');
    this.compact = compact;
    this.labels = new Map();
    this.fixups = [];
  }

  mark(name) {
    if (typeof name !== 'string' || !name || this.labels.has(name)) throw new CilError('Duplicate or invalid IL label');
    this.labels.set(name, this.length);
    return this;
  }

  finish() {
    for (const fixup of this.fixups) {
      if (!this.labels.has(fixup.label)) throw new CilError(`Undefined IL label '${fixup.label}'`);
      const delta = this.labels.get(fixup.label) - fixup.base;
      if (fixup.size === 1) {
        if (delta < -128 || delta > 127) throw new CilError('Short branch displacement out of range');
        this.view.setInt8(fixup.at, delta);
      } else this.patch32(fixup.at, delta);
    }
    return super.finish();
  }

  /** Return relaxed code and original-boundary to final-boundary offsets without changing this writer. */
  finishWithLayout(options) {
    return finishCilLayout(this.buffer.subarray(0, this.length), this.labels, this.fixups, options);
  }

  op(name, operand) {
    const opcode = typeof name === 'string' ? opcodeByName[name] : undefined;
    if (!opcode) {
      throw new CilError(typeof name === 'string' ? `Unsupported CIL opcode ${name}` : 'Invalid CIL opcode name');
    }
    if (opcode.value > 255) this.u8(0xfe).u8(opcode.value & 255);
    else this.u8(opcode.value);
    if (opcode.operand.startsWith('br') && typeof operand === 'string') {
      const size = opcode.operand === 'br8' ? 1 : 4;
      this.fixups.push({ at: this.length, base: this.length + size, size, label: operand });
      operand = 0;
    }
    switch (opcode.operand) {
      case 'u8': case 'i8': case 'br8': this.u8(operand); break;
      case 'u16': this.u16(operand); break;
      case 'i32': case 'token': case 'br32': this.u32(operand); break;
      case 'f32': this.f32(operand); break;
      case 'f64': this.f64(operand); break;
      case 'i64': this.i64(operand); break;
      case 'switch': this.#switchTargets(operand); break;
    }
    return this;
  }

  #switchTargets(targets) {
    const base = this.length + 4 + targets.length * 4;
    this.u32(targets.length);
    for (const target of targets) {
      if (typeof target === 'string') {
        this.fixups.push({ at: this.length, base, size: 4, label: target });
        this.u32(0);
      } else this.u32(target);
    }
  }

  local(name, index) { return emitLocal(this, name, index, this.compact); }
  integer(value) { return emitInteger(this, value, this.compact); }
  /** Write a target instruction with a bounded validated prefix sequence; operands keep op() wire semantics. */
  group(name, operand, prefixes) { return emitInstructionGroup(this, name, operand, prefixes); }
}
