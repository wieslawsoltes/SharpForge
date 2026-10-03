/** A canonical metadata definition identity. Inheritance/layout are resolved by later services. */
export class TypeDesc {
  #state;
  constructor(state, key) {
    if (key !== creationKey) throw new TypeError('Type descriptors are created by their runtime module');
    this.#state = state;
    Object.freeze(this);
  }
  get name() { return this.#state.name; }
  get namespace() { return this.#state.namespace; }
  get fullName() { return this.#state.fullName; }
  get flags() { return this.#state.flags; }
  get isInterface() { return Boolean(this.flags & 0x20); }
  get module() { return this.#state.module; }
  get assembly() { return this.module.assembly; }
  get loadContext() { return this.assembly.loadContext; }
  get metadataToken() { return this.#state.token; }
  get declaringType() { return this.#state.declaringType; }
  toString() { return this.fullName; }
}

const creationKey = Symbol('TypeDesc creation');
export function createTypeDesc(state) { return new TypeDesc(state, creationKey); }
