/**
 * A construct the direct CIL emitter has no code for yet (SF-A02-T30). The program is valid C#; `compileToAssembly`
 * reports it as SF2200 with the construct named and produces no assembly, never a wrong one.
 */
export class UnsupportedInCil extends Error {
  /** @param {string} construct what cannot be emitted  @param syntax the syntax node it was written at, or null */
  constructor(construct, syntax = null, uri = null) {
    super(construct);
    this.name = 'UnsupportedInCil';
    this.construct = construct;
    this.syntax = syntax;
    this.uri = uri;
  }
}

/** `ObjectCreation` -> "object creation", for the message. */
export function describeKind(kind) {
  return String(kind)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}
