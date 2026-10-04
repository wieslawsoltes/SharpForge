import { decodeCoded } from '@sharpforge/cil';
import { loadError, LoadErrorCode } from '../load-errors.js';

/** Canonical Event metadata identity; the event type remains an unresolved module-relative token. */
export class EventDesc {
  #state;
  #accessors;
  constructor(state, key) {
    if (key !== creationKey) throw new TypeError('Event descriptors are created by their runtime module');
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
  get eventTypeToken() { return this.#state.eventTypeToken; }
  get #methods() { return this.#accessors ??= this.module.eventAccessors(this.metadataToken); }
  get addMethod() { return this.#methods.addMethod; }
  get removeMethod() { return this.#methods.removeMethod; }
  get raiseMethod() { return this.#methods.raiseMethod; }
  get otherMethods() { return this.#methods.otherMethods; }
}

const creationKey = Symbol('EventDesc creation');
export function createEventDesc(state) { return new EventDesc(state, creationKey); }

/** Validate only the coded index/row extent; delegate compatibility and TypeSpec decoding are separate services. */
export function initializeEventType(state, row) {
  const token = decodeCoded('TypeDefOrRef', row[2]);
  if (token && (!(token & 0xffffff) || (token & 0xffffff) > state.module.rowCount(token >>> 24))) {
    throw loadError(LoadErrorCode.InvalidImage, 'Invalid event type token');
  }
  state.eventTypeToken = token;
}
