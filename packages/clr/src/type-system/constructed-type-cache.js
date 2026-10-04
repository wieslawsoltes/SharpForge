import { TypeDesc } from './type-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

/** One type service's bounded canonical identities and constructed descriptor storage. */
export class ConstructedTypeCache {
  #maxTypes;
  #identities = new WeakMap();
  #nextIdentity = 0;
  #types = new Map();

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

  get(key) {
    return this.#types.get(key);
  }

  ensureCapacity() {
    if (this.#types.size >= this.#maxTypes) {
      throw loadError(LoadErrorCode.LimitExceeded, 'Constructed type count limit exceeded');
    }
  }

  add(key, type) {
    this.#types.set(key, type);
    return type;
  }
}
