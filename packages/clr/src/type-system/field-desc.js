import { readFrozenSignature } from './frozen-signature.js';

/** Canonical FieldDef metadata identity; signatures and raw constants are decoded lazily. */
export class FieldDesc {
  #state;
  #signature;
  #constant;
  constructor(state, key) {
    if (key !== creationKey) throw new TypeError('Field descriptors are created by their runtime module');
    this.#state = state;
    Object.freeze(this);
  }
  get name() { return this.#state.name; }
  get flags() { return this.#state.flags; }
  get metadataToken() { return this.#state.token; }
  get declaringType() { return this.#state.declaringType; }
  get module() { return this.#state.module; }
  get assembly() { return this.module.assembly; }
  get loadContext() { return this.assembly.loadContext; }
  get isStatic() { return Boolean(this.flags & 0x10); }
  get isInitOnly() { return Boolean(this.flags & 0x20); }
  get isLiteral() { return Boolean(this.flags & 0x40); }
  get signature() {
    return this.#signature ??= readFrozenSignature(this.module, this.#state.signatureIndex, 'field');
  }
  get constant() {
    if (this.#constant !== undefined) return this.#constant;
    return this.#constant = this.module.constant(this.metadataToken);
  }
}

const creationKey = Symbol('FieldDesc creation');
export function createFieldDesc(state) { return new FieldDesc(state, creationKey); }
