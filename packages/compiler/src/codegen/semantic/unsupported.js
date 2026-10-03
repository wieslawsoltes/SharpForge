/**
 * The signal code generation raises for a construct that is valid C# but cannot be expressed with the instructions the
 * runtime has today. It is caught once, at the top of the generator, and becomes diagnostic SF2200 naming the
 * construct; nothing is emitted for the program, so nothing is miscompiled.
 */
export class UnsupportedConstruct extends Error {
  /**
   * @param {string} construct what the program uses, as shown to the user ("typed exception handlers")
   * @param {object} [syntax] the syntax node (or `{span}`) the diagnostic points at
   */
  constructor(construct, syntax = null) {
    super(construct);
    this.name = 'UnsupportedConstruct';
    this.construct = construct;
    this.syntax = syntax;
  }
}

/** Raises `UnsupportedConstruct`; an expression so it can be used with `??` and in arrow bodies. */
export function unsupported(construct, syntax = null) {
  throw new UnsupportedConstruct(construct, syntax);
}
