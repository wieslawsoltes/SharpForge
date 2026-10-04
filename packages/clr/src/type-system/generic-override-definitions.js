import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

const unsupported = message => loadError(LoadErrorCode.TypeLoad, message);

/** Validate open generic definitions for signature identity; this does not construct a runtime instantiation. */
export class GenericOverrideDefinitions {
  #loader;
  #limit;
  #definitions = new WeakMap();
  constructor(loader, limit) { this.#loader = loader; this.#limit = limit; }
  async resolve(module, node, signal) {
    if (![1, 2].includes(node.type.token >>> 24)) throw unsupported('Generic override definition requires a TypeDef or TypeRef');
    if (node.arguments.some(argument => ['byref', 'pointer', 'functionPointer'].includes(argument.kind) ||
      (argument.kind === 'primitive' && ['void', 'typedref'].includes(argument.name)))) {
      throw unsupported('Generic override arguments require ordinary managed signature types');
    }
    const definition = await this.#loader.load(module, node.type.token, { signal });
    checkCancellation(signal);
    if ((node.type.kind === 'valuetype') !== ['valuetype', 'enum'].includes(definition.kind)) {
      throw unsupported('Generic override signature type category mismatch');
    }
    let arity = this.#definitions.get(definition);
    if (arity === undefined) {
      const metadata = definition.module;
      if (metadata && metadata.rowCount(42) + metadata.rowCount(44) > this.#limit) {
        throw loadError(LoadErrorCode.LimitExceeded, 'Generic override metadata row limit exceeded');
      }
      const parameters = definition.genericParameters;
      if (parameters.some(parameter => parameter.genericParameterAttributes || parameter.genericParameterConstraintTokens.length)) {
        throw unsupported('Constrained or variant generic override definitions require generic binding');
      }
      arity = parameters.length;
      if (!arity) throw unsupported('Generic override signature requires a generic definition');
      checkCancellation(signal);
      this.#definitions.set(definition, arity);
    }
    if (arity !== node.arguments.length) throw unsupported('Generic override signature argument count does not match its definition');
    return definition;
  }
}
