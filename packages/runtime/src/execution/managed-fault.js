/** A managed exception with an optional generation-checked heap reference. */
export class ManagedFault extends Error {
  constructor(type, message, reference = null) {
    super(message);
    this.name = type;
    this.reference = reference;
  }
}

/** Recognize the public shape; the owning heap validates ownership and lifetime. */
export function isReference(value) {
  return value !== null && typeof value === 'object'
    && Number.isInteger(value.h) && Number.isInteger(value.g);
}
