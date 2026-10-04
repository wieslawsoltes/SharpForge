import { decodeCoded, decodeTypeSignature } from '@sharpforge/cil';
import { TypeKind } from './type-desc.js';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';

/** Cache only unbound TypeSpec syntax; each resolution uses its own ordered generic environment. */
export class TypeSpecifications {
  #specifications = new WeakMap();
  #categories = new WeakMap();
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
    const bindings = {
      scope: operation.scope,
      visit: () => work.visit(),
      beginGeneric: () => {
        operation.root.contextOwnedBindings = true;
        work.observeContext(operation.root.originContext, operation.root.originWasUnloading);
      },
      observe: type => work.observe(type),
      instantiate: (definition, arguments_) => {
        work.observe(definition);
        for (const argument of arguments_) work.observe(argument);
        return this.#operations.instantiate(definition, arguments_);
      },
      validateCategory: (type, kind) => this.#validateCategory(type, kind, identity),
    };
    return this.#constructions.signature(signature, token => this.#operations.load(module, token, identity), operation.signal, bindings);
  }

  async #validateCategory(type, kind, operation) {
    const definition = type.genericDefinition ?? type;
    let category = definition.kind;
    if (!definition.isLoaded && !definition.isInterface) {
      category = this.#categories.get(definition);
      if (!category) {
        const module = definition.module;
        const owner = definition.loadContext.types;
        const baseToken = module.row(definition.metadataToken)[3];
        const baseType = baseToken ? await this.#categoryBase(module, decodeCoded('TypeDefOrRef', baseToken), {
          ...operation, scope: this.#operations.scope(definition), identityOnly: true,
        }) : null;
        category = owner.isIntrinsic(baseType, 'System.ValueType') ? TypeKind.ValueType
          : owner.isIntrinsic(baseType, 'System.Enum') ? TypeKind.Enum : TypeKind.Class;
        checkCancellation(operation.signal);
        this.#categories.set(definition, category);
      }
    }
    if ((kind === 'valuetype') !== [TypeKind.ValueType, TypeKind.Enum].includes(category)) {
      throw loadError(LoadErrorCode.TypeLoad, 'Signature class/value category does not match its definition');
    }
  }

  #categoryBase(module, token, operation) {
    // Only the non-generic canonical ValueType/Enum definitions establish a value category.
    // Resolving a generic base's arguments here would recurse through legal Node<T> : Base<Node<T>> metadata.
    if (token >>> 24 === 27 && this.#read(module, token).signature.kind === 'genericInstance') return null;
    return this.#operations.load(module, token, operation);
  }
}
