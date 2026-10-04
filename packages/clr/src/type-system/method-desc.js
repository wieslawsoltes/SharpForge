import { decodeSignature } from '@sharpforge/cil';
import { freezeSignature } from './frozen-signature.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

/** Canonical MethodDef metadata identity. Signature and body decoding remain lazy. */
export class MethodDesc {
  #state;
  #signature;
  constructor(state, key) {
    if (key !== creationKey) throw new TypeError('Method descriptors are created by their runtime module');
    this.#state = state;
    Object.freeze(this);
  }
  get name() { return this.#state.name; }
  get flags() { return this.#state.flags; }
  get implementationFlags() { return this.#state.implementationFlags; }
  get metadataToken() { return this.#state.token; }
  get declaringType() { return this.#state.declaringType; }
  get module() { return this.#state.module; }
  get assembly() { return this.module.assembly; }
  get loadContext() { return this.assembly.loadContext; }
  get isStatic() { return Boolean(this.flags & 0x10); }
  get isAbstract() { return Boolean(this.flags & 0x400); }
  get isFinal() { return Boolean(this.flags & 0x20); }
  get isVirtual() { return Boolean(this.flags & 0x40); }
  get isHideBySig() { return Boolean(this.flags & 0x80); }
  get isSpecialName() { return Boolean(this.flags & 0x800); }
  get isPrivate() { return (this.flags & 7) === 1; }
  get isFamilyAndAssembly() { return (this.flags & 7) === 2; }
  get isAssembly() { return (this.flags & 7) === 3; }
  get isFamily() { return (this.flags & 7) === 4; }
  get isFamilyOrAssembly() { return (this.flags & 7) === 5; }
  get isPublic() { return (this.flags & 7) === 6; }
  /** Reflection CallingConventions bits, projected lazily from the cached signature header. */
  get callingConvention() {
    const signature = this.signature;
    return (signature.callingConvention === 5 ? 2 : 1) | (signature.hasThis ? 0x20 : 0) | (signature.explicitThis ? 0x40 : 0);
  }
  get #parameterMetadata() { return this.#state.parameterMetadata ??= this.module.methodParameters(this.metadataToken); }
  get parameters() { return this.#parameterMetadata.parameters; }
  get returnParameter() { return this.#parameterMetadata.returnParameter; }
  get genericParameters() { return this.#state.genericParameters ??= this.module.methodGenericParameters(this.metadataToken); }
  get signature() {
    if (this.#signature) return this.#signature;
    try {
      const signature = decodeSignature(this.module.blob(this.#state.signatureIndex, { maxBytes: 1024 * 1024 }));
      if (signature.kind !== 'method' || signature.hasThis === this.isStatic) {
        throw loadError(LoadErrorCode.InvalidImage, 'MethodDef signature kind or receiver does not match its flags');
      }
      this.#signature = freezeSignature(signature);
      return this.#signature;
    } catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw loadError(LoadErrorCode.InvalidImage, `Invalid method signature: ${error.message}`);
    }
  }
  /** Returns null for absent RVA or an isolated body snapshot; executable bytes are never cached on this descriptor. */
  getMethodBody() { return this.module.methodBody(this.metadataToken); }
}

const creationKey = Symbol('MethodDesc creation');
export function createMethodDesc(state) { return new MethodDesc(state, creationKey); }
