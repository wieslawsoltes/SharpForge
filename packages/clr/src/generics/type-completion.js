import { TypeKind } from '../type-system/type-desc.js';
import { requireUnconstrainedParameter } from './instantiation.js';
import { InstantiationTypeSubstitution } from './type-substitution.js';

const handlers = Object.freeze({
  [TypeKind.Instantiation]: (service, type, operation) => service.instance(type, operation),
  [TypeKind.GenericParameter]: (service, type, operation) => service.parameter(type, operation),
});

export function isGenericCompletionKind(kind) { return Object.hasOwn(handlers, kind); }

/** Generic graph completion uses the loader's canonical identity, work and publication services. */
export class GenericTypeCompletion {
  #services;
  #maxDepth;

  constructor(services, maxDepth) {
    this.#services = Object.freeze(services);
    this.#maxDepth = maxDepth;
  }

  complete(type, operation) { return handlers[type.kind](this, type, operation); }

  async instance(type, operation) {
    const nested = { ...operation, path: new Set([...operation.path, type]), identityOnly: false, rootResult: false };
    const definition = await this.#services.complete(type.genericDefinition, nested);
    const work = this.#services.work(operation);
    const substitution = new InstantiationTypeSubstitution(definition, type.genericArguments, {
      signal: operation.signal,
      visit: () => work.visit(),
      instantiate: this.#services.instantiate,
      element: this.#services.element,
      functionPointer: this.#services.functionPointer,
    }, this.#maxDepth);
    const baseType = substitution.apply(definition.baseType);
    if (baseType) await this.#services.complete(baseType, nested);
    const interfaces = new Set();
    for (const template of definition.interfaces) {
      const contract = substitution.apply(template);
      await this.#services.complete(contract, nested);
      interfaces.add(contract);
    }
    this.#services.publish(type, { baseType, interfaces: Object.freeze([...interfaces]), loaded: true }, operation);
    return type;
  }

  parameter(type, operation) {
    requireUnconstrainedParameter(type);
    this.#services.publish(type, {
      baseType: this.#services.intrinsic('System.Object'), interfaces: Object.freeze([]), loaded: true,
    }, operation);
    return type;
  }
}
