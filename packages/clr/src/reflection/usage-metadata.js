import { decodeCoded, decodeSignature } from '@sharpforge/cil';
import { OverrideSignatures } from '../type-system/override-signature.js';
import { MethodImplementationRows, methodImplToken } from '../type-system/method-impl-rows.js';
import { invalidRelation, unsupportedRelation } from './usage-budget.js';

/** Canonical descriptor/signature operations shared by both declaration relation builders. */
export class UsageMethodMetadata {
  #loader;
  #budget;
  #signatures;
  #implementations;
  #methods = new WeakMap();
  #roots = new WeakMap();
  #resolvedSlots = new WeakMap();
  #slotsComplete = new WeakSet();
  #publicSlots = new WeakMap();
  #definitionSignatures = new WeakMap();
  #interfaces = new WeakMap();
  #direct = new WeakMap();
  #explicit = new WeakMap();
  #explicitOwners = new WeakMap();
  constructor(loader, budget) {
    this.#loader = loader;
    this.#budget = budget;
    this.#signatures = new OverrideSignatures(loader, budget.maxMetadataRows);
    this.#implementations = new MethodImplementationRows(budget.maxMetadataRows);
  }

  async load(type) {
    this.#budget.work();
    this.#budget.include(type.module);
    return this.#loader.load(type.module, type.metadataToken, { signal: this.#budget.signal });
  }

  requireDefinition(type) {
    if (!type.module || type.metadataToken >>> 24 !== 2) {
      throw unsupportedRelation('Declaration relationships require metadata type definitions');
    }
    this.#budget.include(type.module);
    if (type.genericParameters.length) throw unsupportedRelation('Generic declaring types require a constructed method-slot provider');
  }

  methods(type) {
    this.#budget.work();
    this.requireDefinition(type);
    if (!this.#methods.has(type)) {
      const methods = type.module.methodDefinitions(type.metadataToken);
      this.#methods.set(type, { methods });
    }
    return this.#methods.get(type);
  }

  async root(method) {
    this.#budget.work();
    if (!this.#roots.has(method)) {
      this.#budget.include(method.module);
      this.requireDefinition(method.declaringType);
      const root = await method.getBaseDefinition({ signal: this.#budget.signal });
      let slots = this.#resolvedSlots.get(method.declaringType);
      if (!slots) this.#resolvedSlots.set(method.declaringType, slots = new Map());
      if (slots.has(root) && slots.get(root) !== method) throw invalidRelation('A declaring type defines duplicate canonical virtual slots');
      slots.set(root, method);
      this.#roots.set(method, root);
    }
    return this.#roots.get(method);
  }

  key(method) {
    this.#budget.work();
    return this.#signatures.key(method, this.#budget.signal);
  }

  knownSlot(type, root) { return this.#resolvedSlots.get(type)?.get(root) ?? null; }

  async virtualSlots(type) {
    if (!this.#slotsComplete.has(type)) {
      for (const method of this.methods(type).methods) {
        if (method.isVirtual && !method.isStatic) await this.root(method);
      }
      this.#slotsComplete.add(type);
    }
    return this.#resolvedSlots.get(type) ?? new Map();
  }

  publicSlots(type) { return this.#signatureIndex(type, true); }

  async #signatureIndex(type, publicOnly) {
    const cache = publicOnly ? this.#publicSlots : this.#definitionSignatures;
    if (cache.has(type)) return cache.get(type);
    const index = new Map();
    for (const method of this.methods(type).methods) {
      this.#budget.work();
      if (publicOnly && (!method.isPublic || !method.isVirtual || method.isStatic)) continue;
      const key = await this.key(method);
      let signatures = index.get(method.name);
      if (!signatures) index.set(method.name, signatures = new Map());
      // Public implicit slots use ECMA's last declaration rule; exact MemberRef binding rejects ambiguity.
      signatures.set(key, !publicOnly && signatures.has(key) ? null : method);
    }
    cache.set(type, index);
    return index;
  }

  async compatible(implementation, declaration) {
    if (await this.key(implementation) !== await this.key(declaration)) return false;
    await this.#signatures.checkConstraints(implementation, declaration, this.#budget.signal);
    return true;
  }

  *ancestry(type) {
    const seen = new Set();
    for (let current = type, depth = 0; current; current = current.baseType, depth++) {
      this.#budget.depth(depth);
      if (seen.has(current)) throw invalidRelation('Circular declaration hierarchy');
      seen.add(current);
      yield current;
    }
  }

  async directInterfaces(type) {
    this.requireDefinition(type);
    if (this.#direct.has(type)) return this.#direct.get(type);
    const module = type.module;
    if (!this.#interfaces.has(module)) {
      const owners = new Map();
      for (let rid = 1; rid <= module.rowCount(9); rid++) {
        this.#budget.work();
        const [owner, coded] = module.row(0x09000000 + rid);
        if (!Number.isInteger(owner) || owner < 1 || owner > module.rowCount(2)) throw invalidRelation('Invalid InterfaceImpl owner');
        if (!Number.isInteger(coded) || coded < 1 || coded >= 0x4000000) throw invalidRelation('Invalid InterfaceImpl encoding');
        let token;
        try { token = decodeCoded('TypeDefOrRef', coded); }
        catch (error) { throw invalidRelation(`Invalid InterfaceImpl token: ${error.message}`); }
        if (!(token & 0xffffff) || (token & 0xffffff) > module.rowCount(token >>> 24)) {
          throw invalidRelation('InterfaceImpl token is outside metadata');
        }
        if (!owners.has(owner)) owners.set(owner, []);
        owners.get(owner).push(token);
      }
      this.#interfaces.set(module, owners);
    }
    const interfaces = new Set();
    const direct = new Set();
    for (const token of this.#interfaces.get(module).get(type.metadataToken & 0xffffff) ?? []) {
      this.#budget.work();
      const contract = await this.#loader.load(module, token, { signal: this.#budget.signal });
      if (!contract.isInterface || direct.has(contract)) throw invalidRelation('Invalid or duplicate InterfaceImpl contract');
      direct.add(contract);
      interfaces.add(contract);
      for (const inherited of contract.interfaces) interfaces.add(inherited);
    }
    this.#direct.set(type, interfaces);
    return interfaces;
  }

  async explicit(type, contract) {
    this.requireDefinition(type);
    let cached = this.#explicit.get(type);
    if (!cached) this.#explicit.set(type, cached = new Map());
    if (cached.has(contract)) return cached.get(contract);
    const mappings = new Map();
    const module = type.module;
    for (const { bodyToken, view } of (await this.#declarations(type)).get(contract) ?? []) {
      this.#budget.work();
      const target = await this.#resolveView(view);
      const implementation = await this.#resolveView(await this.#methodView(module, bodyToken));
      if (implementation.declaringType !== type) throw invalidRelation('MethodImpl body belongs to another type');
      if (!implementation.isVirtual || implementation.isStatic || !target.isVirtual || target.isStatic) {
        throw unsupportedRelation('MethodImpl interface mapping requires virtual instance methods');
      }
      if (mappings.has(target)) throw invalidRelation('Duplicate canonical MethodImpl declaration');
      if (!await this.compatible(implementation, target)) throw invalidRelation('MethodImpl declaration and body signatures do not match');
      mappings.set(target, implementation);
    }
    cached.set(contract, mappings);
    return mappings;
  }

  async #declarations(type) {
    if (this.#explicitOwners.has(type)) return this.#explicitOwners.get(type);
    const owners = new Map();
    const module = type.module;
    for (const [, body, declaration] of this.#implementations.forType(type, this.#budget.signal)) {
      this.#budget.work();
      const bodyToken = methodImplToken(module, 'MethodDefOrRef', body);
      const declarationToken = methodImplToken(module, 'MethodDefOrRef', declaration);
      const view = await this.#methodView(module, declarationToken);
      if (!view.owner.isInterface) throw unsupportedRelation('Class MethodImpl and covariant slots require an explicit class-slot provider');
      if (!owners.has(view.owner)) owners.set(view.owner, []);
      owners.get(view.owner).push({ bodyToken, view });
    }
    this.#explicitOwners.set(type, owners);
    return owners;
  }

  hasInterfaceOverrides(interfaces) {
    for (const contract of interfaces) {
      this.#budget.work();
      if (!contract.module) continue;
      this.#budget.include(contract.module);
      if (this.#implementations.forType(contract, this.#budget.signal).length) return true;
    }
    return false;
  }

  async #methodView(module, token) {
    this.#budget.work();
    if (token >>> 24 === 6) {
      const method = module.methodDefinition(token);
      return { owner: method.declaringType, method };
    }
    const [parent, nameIndex, blob] = module.row(token);
    const ownerToken = methodImplToken(module, 'MemberRefParent', parent);
    if (![1, 2].includes(ownerToken >>> 24)) throw unsupportedRelation('MethodImpl MemberRef requires a TypeDef or TypeRef parent');
    const owner = await this.#loader.load(module, ownerToken, { signal: this.#budget.signal });
    let signature;
    try { signature = decodeSignature(module.blob(blob, { maxBytes: 4096 }), { maxDepth: 32, maxNodes: 4096 }); }
    catch (error) {
      if (error.code?.startsWith('SFCLR')) throw error;
      throw invalidRelation(`Invalid MethodImpl signature: ${error.message}`);
    }
    if (signature.kind !== 'method') throw invalidRelation('MethodImpl MemberRef does not name a method');
    return { owner, reference: { module, signature, name: module.string(nameIndex, { maxBytes: 4096 }),
      genericParameters: { length: signature.genericArity } } };
  }

  async #resolveView(view) {
    if (view.method) return view.method;
    const { reference, owner } = view;
    const key = await this.key(reference);
    const found = (await this.#signatureIndex(owner, false)).get(reference.name)?.get(key);
    if (found === null) throw invalidRelation('Ambiguous MethodImpl MemberRef definition');
    if (!found) throw unsupportedRelation('MethodImpl MemberRef has no canonical method definition');
    return found;
  }
}
