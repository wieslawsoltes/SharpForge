import { readFrozenSignature } from './frozen-signature.js';
import { readCustomModifierTokens } from './custom-modifiers.js';

/** Canonical Property metadata identity; accessor links and signatures remain lazy. */
export class PropertyDesc {
  #state;
  #signature;
  #accessors;
  #constant;
  #indexParameters;
  #modifiers;
  constructor(state, key) {
    if (key !== creationKey) throw new TypeError('Property descriptors are created by their runtime module');
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
  get signature() { return this.#signature ??= readFrozenSignature(this.module, this.#state.signatureIndex, 'property'); }
  get isStatic() { return !this.signature.hasThis; }
  get #customModifiers() { return this.#modifiers ??= readCustomModifierTokens(this.signature.returnType, this.module); }
  get requiredCustomModifierTokens() { return this.#customModifiers.required; }
  get optionalCustomModifierTokens() { return this.#customModifiers.optional; }
  get #methods() { return this.#accessors ??= this.module.propertyAccessors(this.metadataToken); }
  get getMethod() { return this.#methods.getMethod; }
  get setMethod() { return this.#methods.setMethod; }
  get otherMethods() { return this.#methods.otherMethods; }
  get indexParameters() { return this.#indexParameters ??= this.module.propertyParameters(this.metadataToken); }
  get constant() {
    if (this.#constant !== undefined) return this.#constant;
    return this.#constant = this.module.constant(this.metadataToken);
  }
}

const creationKey = Symbol('PropertyDesc creation');
export function createPropertyDesc(state) { return new PropertyDesc(state, creationKey); }
