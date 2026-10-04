/**
 * Index of the string-typed pipeline's method records (`Compilation.methods`), so that looking a method up by name
 * or checking a new declaration for a duplicate signature does not scan every method of the compilation.
 *
 * Records are added once, when declared, and their name, owner and parameter types do not change afterwards.
 */

const none = Object.freeze([]);

/** The text two methods of one owner must share to be duplicates (CS0111): the name and the parameter types. */
const signatureOf = method => method.name + '(' + method.parameters.map(parameter => parameter.type).join(',') + ')';

export class MethodIndex {
  constructor() {
    this.byName = new Map();
    this.signaturesByOwner = new Map();
  }

  /** The methods with this name, in declaration order. The list is the index's own: do not modify it. */
  named(name) {
    return this.byName.get(name) ?? none;
  }

  /** True when `method`'s owner (null for top-level methods) already declares a method with its name and parameter types. */
  hasSignature(method) {
    return this.signaturesByOwner.get(method.owner)?.has(signatureOf(method)) ?? false;
  }

  add(method) {
    const named = this.byName.get(method.name);
    if (named) named.push(method);
    else this.byName.set(method.name, [method]);
    let signatures = this.signaturesByOwner.get(method.owner);
    if (!signatures) this.signaturesByOwner.set(method.owner, (signatures = new Set()));
    signatures.add(signatureOf(method));
  }
}
