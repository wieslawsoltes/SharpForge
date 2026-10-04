import { CilError } from '../binary.js';
import { dataflowLimit, dataflowFailure } from './dataflow.js';

/** One reusable transfer buffer. The cumulative copy budget also bounds retained block-state slots. */
export class TypedTransferStack {
  #values;
  #remaining;
  length = 0;
  peak = 0;
  ended = false;
  instruction = null;

  constructor(method, options) {
    this.method = method;
    this.#remaining = dataflowLimit(options.maxTypedStackSlots, 1000000, 1000000);
    this.charge(method.maxStack);
    this.#values = new Array(method.maxStack);
  }

  fail = (diagnostic, message = diagnostic, unknown = false) => {
    const error = new CilError(message);
    error.code = unknown ? 'CILT0002' : 'CILT0001';
    error.diagnostic = diagnostic;
    error.offset = this.instruction?.offset;
    throw error;
  };

  charge(slots) {
    if (slots > this.#remaining) dataflowFailure('Typed stack slot-work budget exceeded');
    this.#remaining -= slots;
  }

  restore(values) {
    this.charge(values.length);
    this.#values.fill(undefined, 0, this.length);
    this.length = 0;
    this.ended = false;
    for (const value of values) this.push(value);
  }

  snapshot() {
    this.charge(this.length);
    return Object.freeze(this.#values.slice(0, this.length));
  }

  push(value) {
    if (this.length >= this.#values.length) this.fail('StackOverflow');
    this.#values[this.length++] = value;
    this.peak = Math.max(this.peak, this.length);
  }

  pop() {
    if (!this.length) this.fail('StackUnderflow');
    const value = this.#values[--this.length];
    this.#values[this.length] = undefined;
    return value;
  }
}
