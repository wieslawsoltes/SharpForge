/** A distinct sentinel: an absent value is never confused with a local null. */
export const UnsetValue = Object.freeze({kind: 'UnsetValue'});

/** A deterministic property-system failure, translated by each host adapter. */
export class PropertyFault extends Error {
  constructor(kind, message, details = null) {
    super(message);
    this.name = kind;
    this.kind = kind;
    this.details = details;
  }
}
