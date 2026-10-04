import { invalidRelation, unsupportedRelation } from './usage-budget.js';

/** Local interface maps over canonical descriptors, with inherited mappings distinct from reimplementation. */
export class UsageInterfaceMaps {
  #metadata;
  #budget;
  #maps = new WeakMap();
  #interfaces = new WeakMap();
  constructor(metadata, budget) {
    this.#metadata = metadata;
    this.#budget = budget;
  }

  async get(type, contract, depth = 0) {
    this.#budget.depth(depth);
    this.#metadata.requireDefinition(type);
    this.#metadata.requireDefinition(contract);
    if (type.isInterface || !contract.isInterface || !this.#implements(type, contract)) {
      throw invalidRelation('Interface map requires a class implementing the canonical interface');
    }
    let cache = this.#maps.get(type);
    if (!cache) this.#maps.set(type, cache = new Map());
    if (cache.has(contract)) return cache.get(contract);
    const result = await this.#build(type, contract, depth);
    cache.set(contract, result);
    return result;
  }

  #implements(type, contract) {
    if (!type) return false;
    if (!this.#interfaces.has(type)) {
      const contracts = new Set();
      for (const implemented of type.interfaces) {
        this.#budget.work();
        contracts.add(implemented);
      }
      this.#interfaces.set(type, contracts);
    }
    return this.#interfaces.get(type).has(contract);
  }

  async #build(type, contract, depth) {
    const inherited = this.#implements(type.baseType, contract)
      ? await this.get(type.baseType, contract, depth + 1) : new Map();
    const direct = (await this.#metadata.directInterfaces(type)).has(contract);
    const explicit = await this.#metadata.explicit(type, contract);
    const result = new Map();
    for (const declaration of this.#metadata.methods(contract).methods) {
      this.#budget.work();
      if (!declaration.isVirtual) continue;
      if (declaration.isStatic) throw unsupportedRelation('Static virtual interface maps require a static-slot provider');
      const inheritedEntry = inherited.get(declaration);
      const selected = explicit.get(declaration) ?? (direct ? await this.#implicit(type, declaration) : null);
      let implementation = selected;
      let implementationKind = explicit.has(declaration) ? 'explicit' : 'implicit';
      if (!implementation && inheritedEntry) {
        implementation = await this.#override(type, inheritedEntry.implementation);
        implementationKind = 'inherited';
      }
      if (!implementation) {
        if (!declaration.isAbstract || this.#metadata.hasInterfaceOverrides(type.interfaces)) {
          throw unsupportedRelation('Default or reabstracted interface methods require a default-interface provider');
        }
        if (!(type.flags & 0x80)) throw invalidRelation('Concrete type has an unimplemented interface method');
        continue;
      }
      if (implementation.isAbstract && !(type.flags & 0x80)) throw invalidRelation('Concrete type has an abstract interface implementation');
      result.set(declaration, { implementation, implementationKind });
    }
    return result;
  }

  async #implicit(type, declaration) {
    const key = await this.#metadata.key(declaration);
    for (const owner of this.#metadata.ancestry(type)) {
      if (!owner.module) continue;
      const found = (await this.#metadata.publicSlots(owner)).get(declaration.name)?.get(key);
      if (!found) continue;
      await this.#metadata.compatible(found, declaration);
      return found;
    }
    return null;
  }

  async #override(type, inherited) {
    const root = await this.#metadata.root(inherited);
    for (const owner of this.#metadata.ancestry(type)) {
      if (owner === inherited.declaringType) return inherited;
      if (!owner.module) continue;
      const selected = (await this.#metadata.virtualSlots(owner)).get(root);
      if (selected) return selected;
    }
    throw invalidRelation('Inherited interface implementation is outside the class hierarchy');
  }
}
