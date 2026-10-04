import { decodeTypeSignature } from '@sharpforge/cil';
import { loadError, LoadErrorCode } from '../load-errors.js';

/** Cache only unbound TypeSpec syntax; each resolution uses its own ordered generic environment. */
export class TypeSpecifications {
  #specifications = new WeakMap();
  #constructions;
  #limits;
  #operations;

  constructor(constructions, limits, operations) {
    this.#constructions = constructions;
    this.#limits = limits;
    this.#operations = operations;
  }

  #read(module, token) {
    let specifications = this.#specifications.get(module);
    if (!specifications) {
      specifications = new Map();
      this.#specifications.set(module, specifications);
    }
    let specification = specifications.get(token);
    if (!specification) {
      if (specifications.size >= this.#limits.maxSpecifications) {
        throw loadError(LoadErrorCode.LimitExceeded, 'TypeSpec limit exceeded');
      }
      const bytes = module.blob(module.row(token)[0], { maxBytes: this.#limits.maxSignatureBytes });
      specification = Object.freeze({ token, signature: decodeTypeSignature(bytes) });
      specifications.set(token, specification);
    }
    return specification;
  }

  async load(module, token, operation) {
    const specification = this.#read(module, token);
    const marker = this.#operations.work(operation).marker(specification, operation.scope);
    if (operation.path.has(marker)) throw loadError(LoadErrorCode.TypeLoad, 'Circular TypeSpec resolution');
    const nested = { ...operation, path: new Set([...operation.path, marker]) };
    const type = await this.signature(module, specification.signature, nested);
    return operation.identityOnly ? type : this.#operations.complete(type, nested);
  }

  signature(module, signature, operation) {
    const work = this.#operations.work(operation);
    const identity = { ...operation, identityOnly: true };
    const beginGeneric = () => {
      operation.root.contextOwnedBindings = true;
      work.observeContext(operation.root.originContext, operation.root.originWasUnloading);
    };
    const bindings = {
      scope: operation.scope,
      visit: () => work.visit(),
      beginGeneric,
      observe: type => work.observe(type),
      instantiate: (definition, arguments_) => {
        work.observe(definition);
        for (const argument of arguments_) work.observe(argument);
        return this.#operations.instantiate(definition, arguments_);
      },
      validateCategory: (type, kind) => {
        beginGeneric();
        work.requireCategory(type, kind);
      },
    };
    return this.#constructions.signature(signature, token => {
      beginGeneric();
      return this.#operations.load(module, token, identity);
    }, operation.signal, bindings);
  }
}
