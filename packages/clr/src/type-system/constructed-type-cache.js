import { TypeDesc } from './type-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

/** One type service's bounded canonical identities and constructed descriptor storage. */
export class ConstructedTypeCache {
  #maxTypes;
  #identities = new WeakMap();
  #nextIdentity = 0;
  #types = new Map();
  #collectibleTypes;

  constructor(maxTypes) {
    this.#maxTypes = maxTypes;
  }

  identity(type) {
    if (!(type instanceof TypeDesc)) throw new TypeError('Expected TypeDesc');
    let identity = this.#identities.get(type);
    if (identity === undefined) {
      if (this.#nextIdentity >= this.#maxTypes) {
        throw loadError(LoadErrorCode.LimitExceeded, 'Constructed type identity limit exceeded');
      }
      identity = ++this.#nextIdentity;
      this.#identities.set(type, identity);
    }
    return identity;
  }

  peekIdentity(type) {
    return this.#identities.get(type);
  }

  ensureIdentityCapacity(definition, arguments_) {
    const missing = new Set();
    if (!this.#identities.has(definition)) missing.add(definition);
    for (const type of arguments_) {
      if (!this.#identities.has(type)) missing.add(type);
    }
    if (this.#nextIdentity + missing.size > this.#maxTypes) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Constructed type identity limit exceeded');
    }
  }

  get(key) {
    return this.#types.get(key) ?? this.#collectibleTypes?.get(key)?.deref();
  }

  ensureCapacity() {
    if (this.#types.size + (this.#collectibleTypes?.size ?? 0) >= this.#maxTypes) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Constructed type count limit exceeded');
    }
  }

  add(key, type) {
    if (type.isCollectible) {
      this.#collectibleTypes ??= new Map();
      this.#collectibleTypes.set(key, new WeakRef(type));
    } else {
      this.#types.set(key, type);
    }
    return type;
  }

  hasIdentityKey(key) {
    return this.#types.has(key) || this.#collectibleTypes?.has(key) === true;
  }
}
