/** A guest-managed failure, independent of host exception implementation details. */
export class ManagedFault extends Error {
  constructor(type, message, reference = null) {
    super(message);
    this.name = type;
    this.reference = reference;
  }
}

/** Shape predicate only; ownership and liveness require the owning heap's checks. */
export function isReference(value) {
  return value !== null && typeof value === 'object' && Number.isInteger(value.h) && Number.isInteger(value.g);
}
