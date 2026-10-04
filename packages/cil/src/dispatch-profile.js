import {isAsyncMethodImplementation} from './async-state-machines.js';
import {CilError} from './binary.js';
import {decodeCoded, token} from './metadata.js';
import {genericTypeParts} from './field-profile.js';
import {instantiateSignature, resolveExecutionMethod, substituteCallType, callSignatureKey, methodGenericParameters} from './call-profile.js';
import {indexDispatchTable} from './vtable-profile.js';
import {inheritInterfaceCandidates, addInterfaceCandidate, completeInterfaceSlots, interfaceReachableTargets}
  from './interface-dispatch-profile.js';

const virtual = 0x40, newslot = 0x100, final = 0x20;
const declarationKey = (owner, method) => owner.includes('<') ? owner + '::' + method : method;

/** Declaration identities include the closed owner; nongeneric token keys remain stable. */
export class CilDispatchTable {
  constructor(inspector) {
    this.inspector = inspector;
    this.types = new Map(inspector.types.map(type => [type.token, type]));
    this.names = new Map(inspector.types.map(type => [type.name, type]));
    this.definitions = new Map(inspector.methods);
    this.tables = new Map();
    this.typeContexts = new Map();
    this.building = new Set();
    this.implementations = new Map();
    this.targetCache = new Map();
    for (const row of inspector.metadata.rows?.[25] ?? []) {
      const owner = token(2, row[0]);
      if (!this.implementations.has(owner)) this.implementations.set(owner, []);
      this.implementations.get(owner).push({
        body: decodeCoded('MethodDefOrRef', row[1]), declaration: decodeCoded('MethodDefOrRef', row[2])
      });
    }
  }

  definition(methodToken, context = null) {
    if (!context && this.definitions.has(methodToken)) return this.definitions.get(methodToken);
    const descriptor = resolveExecutionMethod(this.inspector, methodToken, context ?? {});
    const method = this.inspector.methods.get(descriptor.resolvedToken);
    if (!method) throw new CilError('External virtual declarations are not executable');
    if (context) return {...method, signature: descriptor.signature, ownerInstance: descriptor.ownerInstance};
    this.definitions.set(methodToken, method);
    return method;
  }

  typeContext(input) {
    if (this.typeContexts.has(input)) return this.typeContexts.get(input);
    if (!input) return {name: '', type: null, arguments: []};
    const raw = typeof input === 'number' ? this.inspector.metadata.typeName(input) : input;
    const parts = genericTypeParts(substituteCallType(raw));
    const type = this.names.get(parts.definition);
    const arity = type ? methodGenericParameters(this.inspector, type.token).length : 0;
    const args = parts.arguments.length ? parts.arguments : Array.from({length: arity}, (_, index) => '!' + index);
    const context = {name: args.length ? parts.definition + '<' + args.join(',') + '>' : parts.definition, type, arguments: args};
    this.typeContexts.set(input, context);
    return context;
  }

  table(input) {
    const context = this.typeContext(input), {name, type} = context;
    if (this.tables.has(name)) return this.tables.get(name);
    if (this.building.has(name) || this.building.size > 64) throw new CilError('Invalid virtual type hierarchy');
    if (!type) return {slots: new Map(), aliases: new Map(), declarations: new Map(), declarationDetails: new Map(),
      visible: new Map(), ancestors: new Set(), instances: new Set(), interfaceCandidates: new Map()};
    this.building.add(name);
    try {
      const inherit = typeToken => this.table(substituteCallType(this.inspector.metadata.typeName(typeToken), context.arguments));
      const base = type.baseToken ? inherit(type.baseToken) : this.table(null);
      const table = {
        slots: new Map(base.slots), aliases: new Map(base.aliases), declarations: new Map(base.declarations),
        declarationDetails: new Map(base.declarationDetails), visible: new Map(base.visible),
        ancestors: new Set(base.ancestors), instances: new Set(base.instances),
        publicMethods: new Map(base.publicMethods ?? []), interfaceSelections: new Map()
      };
      table.ancestors.add(type.token);
      table.instances.add(name);
      const interfaces = type.interfaces.map(inherit);
      for (const inherited of interfaces) {
        for (const ancestor of inherited.ancestors) table.ancestors.add(ancestor);
        for (const instance of inherited.instances) table.instances.add(instance);
        for (const [key, slot] of inherited.declarations) table.declarations.set(key, slot);
        for (const [key, value] of inherited.declarationDetails) table.declarationDetails.set(key, value);
        if (type.flags & 0x20) {
          for (const field of ['slots', 'aliases', 'visible']) {
            for (const [key, value] of inherited[field]) table[field].set(key, value);
          }
        }
      }
      table.interfaceCandidates = inheritInterfaceCandidates([base, ...interfaces]);
      this.addMethods(table, context);
      this.addImplicitImplementations(table, type, interfaces);
      this.addExplicitImplementations(table, context, base);
      this.tables.set(name, table);
      try {
        completeInterfaceSlots(this, table);
        indexDispatchTable(table, (owner, slot) => this.resolveSlot(owner, slot));
        return table;
      } catch (error) {
        this.tables.delete(name);
        throw error;
      }
    } finally {
      this.building.delete(name);
    }
  }

  addMethods(table, context) {
    const {type, name} = context;
    for (const method of type.methods) {
      if (!(method.flags & virtual) || method.flags & 0x10) continue;
      const signature = instantiateSignature(this.inspector.signature(method.token), context.arguments);
      const key = method.name + '::' + callSignatureKey(signature);
      const privateBody = (method.flags & 7) === 1;
      const inherited = method.flags & newslot || privateBody ? undefined : table.visible.get(key);
      const declaration = declarationKey(name, method.token), slot = inherited ?? declaration;
      if (inherited !== undefined && this.inspector.methods.get(this.resolveSlot(table, slot))?.flags & final) {
        throw new CilError('A final virtual method cannot be overridden');
      }
      table.aliases.delete(slot);
      table.slots.set(slot, method.token);
      table.declarations.set(declaration, slot);
      table.declarationDetails.set(declaration, {token: method.token, owner: name, signature, slot});
      if (!privateBody) table.visible.set(key, slot);
      if ((method.flags & 7) === 6) table.publicMethods.set(key, slot);
      if (type.flags & 0x20) addInterfaceCandidate(table.interfaceCandidates, slot, name, method.token);
    }
  }

  addImplicitImplementations(table, type, interfaces) {
    if (type.flags & 0x20) return;
    for (const iface of interfaces) for (const declaration of iface.declarationDetails.values()) {
      const method = this.inspector.methods.get(declaration.token);
      if ((method.flags & 7) !== 6) continue;
      const key = method.name + '::' + callSignatureKey(declaration.signature);
      const implementation = table.publicMethods.get(key);
      if (implementation === undefined) continue;
      table.slots.set(declaration.slot, table.slots.get(implementation));
      if (declaration.slot !== implementation) table.aliases.set(declaration.slot, implementation);
    }
  }

  addExplicitImplementations(table, context, base) {
    const {type, name} = context, explicit = new Set();
    const callContext = {ownerToken: type.token, genericIdentity: name, typeArguments: context.arguments};
    for (const implementation of this.implementations.get(type.token) ?? []) {
      if (isAsyncMethodImplementation(this.inspector, name, implementation)) continue;
      const declaration = this.definition(implementation.declaration, callContext);
      const body = this.definition(implementation.body, callContext);
      if (!(declaration.flags & virtual) || declaration.flags & 0x10 || body.flags & 0x10 ||
          !table.ancestors.has(declaration.ownerToken) || !table.ancestors.has(body.ownerToken)) {
        throw new CilError('Invalid MethodImpl owner or virtual declaration');
      }
      if (callSignatureKey(declaration.signature) !== callSignatureKey(body.signature)) {
        throw new CilError('MethodImpl signatures do not match');
      }
      const owner = declaration.ownerInstance ? this.typeContext(declaration.ownerInstance).name : null;
      const candidates = [...table.declarationDetails.values()].filter(item =>
        item.token === declaration.token && (owner === null || item.owner === owner));
      if (candidates.length !== 1 || explicit.has(candidates[0].slot)) {
        throw new CilError('Invalid or duplicate MethodImpl declaration');
      }
      const slot = candidates[0].slot, previous = this.resolveSlot(base, slot);
      if (!(this.types.get(declaration.ownerToken)?.flags & 0x20) && this.inspector.methods.get(previous)?.flags & final) {
        throw new CilError('A final virtual method cannot be overridden');
      }
      const bodySlot = table.declarations.get(declarationKey(name, body.token));
      if (type.flags & 0x20) addInterfaceCandidate(table.interfaceCandidates, slot, name, body.token);
      explicit.add(slot);
      table.slots.set(slot, body.token);
      if (bodySlot !== undefined && bodySlot !== slot) table.aliases.set(slot, bodySlot);
      else table.aliases.delete(slot);
    }
  }

  resolveSlot(table, slot) {
    if (table.targets) return table.targets[table.slotIndexes.get(slot)];
    const seen = new Set();
    while (table.aliases.has(slot)) {
      if (seen.has(slot)) throw new CilError('Cyclic MethodImpl slot mapping');
      seen.add(slot);
      slot = table.aliases.get(slot);
    }
    return table.slots.get(slot);
  }

  resolve(type, methodToken, ownerInstance = null) {
    const declaration = this.definition(methodToken);
    if (!(declaration.flags & virtual)) return declaration.token;
    const table = this.table(type), owners = table.declarationsByToken.get(declaration.token);
    const owner = ownerInstance ? this.typeContext(ownerInstance).name : null;
    if (!owners || (owner === null ? owners.size !== 1 : !owners.has(owner))) {
      throw new CilError('Virtual receiver is incompatible or ambiguous for the method declaration');
    }
    const index = owner === null ? owners.values().next().value : owners.get(owner);
    const target = table.targets[index];
    if (target === undefined) throw new CilError('Virtual method has no implementation');
    return target;
  }

  isAssignable(typeToken, ownerToken) {
    return this.table(typeToken).ancestors.has(ownerToken);
  }

  targets(methodToken) {
    if (this.targetCache.has(methodToken)) return this.targetCache.get(methodToken);
    const declaration = this.definition(methodToken), targets = new Set();
    for (const type of this.types.values()) {
      if (type.flags & 0xa0) continue;
      const table = this.table(type.token);
      for (const candidate of table.declarationDetails.values()) {
        if (candidate.token !== declaration.token) continue;
        const target = this.resolveSlot(table, candidate.slot), method = this.inspector.methods.get(target);
        if (method?.hasBody && !(method.flags & 0x400)) targets.add(target);
        if (target?.ambiguousImplementation) {
          for (const body of interfaceReachableTargets(table, candidate.slot, this.inspector)) targets.add(body);
        }
      }
    }
    this.targetCache.set(methodToken, targets);
    return targets;
  }
}
