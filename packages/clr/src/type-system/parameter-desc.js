import { formatParameterDisplay } from './parameter-display.js';
import { readCustomModifierTokens } from './custom-modifiers.js';

/** Canonical method or property parameter metadata. A zero token denotes an omitted Param row. */
export class ParameterDesc {
  #state;
  #constant;
  #modifiers;
  constructor(state, key) {
    if (key !== creationKey) throw new TypeError('Parameter descriptors are created by their runtime module');
    this.#state = state;
    Object.freeze(this);
  }
  get name() { return this.#state.name; }
  get position() { return this.#state.position; }
  get flags() { return this.#state.flags; }
  get metadataToken() { return this.#state.token; }
  get method() { return this.#state.method; }
  get member() { return this.#state.member ?? this.method; }
  get module() { return this.method.module; }
  get signatureType() { return this.#state.signatureType; }
  get #customModifiers() {
    if (this.#modifiers) return this.#modifiers;
    const type = this.#state.source ? this.member.signature.parameters[this.position] : this.signatureType;
    return this.#modifiers = readCustomModifierTokens(type, this.module);
  }
  get requiredCustomModifierTokens() { return this.#customModifiers.required; }
  get optionalCustomModifierTokens() { return this.#customModifiers.optional; }
  get isIn() { return Boolean(this.flags & 1); }
  get isOut() { return Boolean(this.flags & 2); }
  get isOptional() { return Boolean(this.flags & 0x10); }
  /** Cached Reflection-style type and optional name; unsupported resolved forms report SFCLR012. */
  toString() { return this.#state.display ??= formatParameterDisplay(this); }
  /** Frozen {type, value} from the Constant table, or null. Custom-attribute defaults are not projected. */
  get constant() {
    if (this.#constant !== undefined) return this.#constant;
    return this.#constant = this.#state.source ? this.#state.source.constant : this.#state.reader.constant(this.metadataToken);
  }
}

const creationKey = Symbol('ParameterDesc creation');
export function createParameterDesc(state) { return new ParameterDesc(state, creationKey); }

/** Retain the accessor's canonical metadata and lazy constant while changing the owning member. */
export function projectParameterDesc(source, member) {
  return createParameterDesc({ source, member, method: source.method, name: source.name, position: source.position,
    flags: source.flags, token: source.metadataToken, signatureType: source.signatureType });
}
