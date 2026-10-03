/** A managed runtime failure; reference optionally names its managed exception. */
export class ManagedFault extends Error {
  constructor(type, message, reference = null) {
    super(message);
    this.name = type;
    this.reference = reference;
  }
}
