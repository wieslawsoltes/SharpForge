import {AssemblyInspector, decodeCoded, intrinsicDefinition} from '@sharpforge/cil';
import {canonicalType as frameworkCanonicalType, contractForMember} from '@sharpforge/framework';
import {UnsetValue} from '@sharpforge/winui-properties';
import {ManagedFault, isReference} from '../heap.js';
import {invokeManagedMethod} from './callbacks.js';
import {castCacheFor} from '../execution/casting.js';
import {invokeIntrinsic} from '../execution/intrinsics.js';

const key = (name, arity) => name + ':' + arity;
const primitiveNames = Object.freeze({
  'System.Object': 'object', 'System.String': 'string', 'System.Boolean': 'bool', 'System.Char': 'char',
  'System.SByte': 'sbyte', 'System.Byte': 'byte', 'System.Int16': 'short', 'System.UInt16': 'ushort',
  'System.Int32': 'int', 'System.UInt32': 'uint', 'System.Int64': 'long', 'System.UInt64': 'ulong',
  'System.Single': 'float', 'System.Double': 'double', 'System.Void': 'void'
});
export function managedBindingTypeName(type) { return primitiveNames[type] ?? frameworkCanonicalType(type); }
const canonicalType = managedBindingTypeName;

/** Indexed source-image/CIL member access, with metadata tokens resolved once per application. */
export class ManagedMemberAccess {
  constructor(context) {
    this.context = context;
    this.platform = context.platform;
    this.vm = this.platform.vm;
    this.types = new Map();
    this.tokens = new Map();
    this.methods = new Map();
    this.maxDepth = context.services?.maxBindingDepth ?? 128;
    this.maxMembers = context.services?.maxBindingMembers ?? 100000;
    if (![this.maxDepth, this.maxMembers].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new RangeError('Binding member budgets must be positive safe integers');
    }
    this.metadata = this.vm.inspector ?? context.services?.compiledMetadata?.inspector ?? context.services?.compiledMetadata ?? null;
    const assembly = context.services?.bindingAssembly ?? this.platform.options.bindingAssembly;
    if (!this.metadata && assembly) this.metadata = new AssemblyInspector(assembly);
    if (this.vm.inspector) this.indexCil();
    else this.indexSource();
  }

  type(name) {
    name = canonicalType(name);
    let entry = this.types.get(name);
    if (!entry) {
      entry = {name, methods: new Map(), fields: new Map(), properties: new Map(), events: new Map()};
      this.types.set(name, entry);
    }
    return entry;
  }

  addMethod(method) {
    if (this.methods.size >= this.maxMembers) throw new ManagedFault('ExecutionLimitException', 'Binding member index budget exceeded');
    const owner = this.type(method.owner);
    const name = key(method.name, method.parameters.length);
    const overloads = owner.methods.get(name) ?? [];
    overloads.push(method);
    owner.methods.set(name, overloads);
    this.methods.set(method.id, method);
    if (method.token) this.tokens.set(method.token, {kind: 'method', ...method});
    const accessor = method.accessor;
    if (accessor && accessor.access !== 'private') {
      const property = owner.properties.get(accessor.property) ?? {kind: 'property', owner: owner.name, name: accessor.property};
      property[accessor.kind] = method;
      property.type = accessor.kind === 'get' ? method.returnType : method.parameters.at(-1);
      owner.properties.set(property.name, property);
    }
  }

  indexSource() {
    const image = this.vm.image;
    for (const type of image.types) {
      const entry = this.type(type.name);
      for (const field of type.fields) entry.fields.set(field.name, {...field, kind: 'field', owner: type.name, isStatic: false});
    }
    const supplied = this.context.services?.compiledMetadata;
    const methodTokens = supplied?.methods ?? supplied?.debug?.methods ?? this.metadata?.debug?.methods ?? [];
    const tokenById = new Map(methodTokens.map(method => [method.id, method.token]));
    for (const [id, token] of Object.entries(supplied?.methodTokens ?? {})) tokenById.set(Number(id), token);
    for (const method of image.methods) this.addMethod({...method, owner: method.owner ?? '',
      token: tokenById.get(method.id) ?? image.il?.methodTokens?.[method.id], parameters: method.parameters.map(parameter => parameter.type)});
    for (let index = 0; index < image.statics.length; index++) {
      const field = image.statics[index];
      const split = field.name.lastIndexOf('.');
      const owner = field.name.slice(0, split);
      this.type(owner).fields.set(field.name.slice(split + 1), {...field, kind: 'field', owner, index, isStatic: true});
    }
    if (this.metadata) this.indexMetadataTokens();
  }

  indexCil() {
    for (const type of this.metadata.types) {
      const entry = this.type(type.name);
      for (const field of type.fields) {
        const member = {...field, kind: 'field', type: this.metadata.signature(field.token).type};
        entry.fields.set(field.name, member);
        this.tokens.set(field.token, member);
      }
      for (const method of type.methods) {
        const signature = this.metadata.signature(method.token);
        this.addMethod({...method, id: method.token, parameters: signature.parameters,
          returnType: signature.returnType, isStatic: signature.isStatic});
      }
    }
    this.indexMetadataTokens();
  }

  indexMetadataTokens() {
    const semantics = new Map();
    for (const row of this.metadata.metadata.rows[24] ?? []) {
      const association = decodeCoded('HasSemantics', row[2]);
      const entry = semantics.get(association) ?? new Map();
      entry.set(row[0], this.tokens.get(0x06000000 | row[1]));
      semantics.set(association, entry);
    }
    for (const type of this.metadata.types) {
      const owner = this.type(type.name);
      for (const field of type.fields) {
        const member = owner.fields.get(field.name);
        if (member) this.tokens.set(field.token, {...member, token: field.token});
      }
      for (const property of type.properties) {
        const accessors = semantics.get(property.token);
        const signature = this.metadata.signature(property.token);
        const member = {kind: 'property', owner: type.name, name: property.name, token: property.token,
          type: signature.returnType, get: accessors?.get(2), set: accessors?.get(1)};
        owner.properties.set(property.name, member);
        this.tokens.set(property.token, member);
      }
      for (const event of type.events) {
        const accessors = semantics.get(event.token);
        const member = {kind: 'event', owner: type.name, name: event.name, token: event.token,
          type: this.metadata.metadata.typeName(decodeCoded('TypeDefOrRef', event.signatureOrType)),
          add: accessors?.get(8), remove: accessors?.get(16)};
        owner.events.set(event.name, member);
        this.tokens.set(event.token, member);
      }
    }
  }

  *ancestry(receiver) {
    let table = isReference(receiver) ? this.platform.heap.get(receiver).methodTable : this.platform.heap.methodTables.get(receiver);
    const seen = new Set();
    while (table) {
      if (seen.has(table) || seen.size >= this.maxDepth) throw new ManagedFault('ExecutionLimitException', 'Binding inheritance depth exceeded');
      seen.add(table);
      yield this.types.get(canonicalType(table.name));
      table = table.base;
    }
  }

  method(receiver, name, arity, {staticOnly = false, interfaceType = null} = {}) {
    for (const type of this.ancestry(receiver)) {
      if (!type) continue;
      const declared = interfaceType ? type.methods.get(key(interfaceType + '.' + name, arity)) : null;
      const matches = (declared ?? type.methods.get(key(name, arity)) ?? []).filter(method => !staticOnly || method.isStatic);
      if (matches.length > 1) throw new ManagedFault('AmbiguousMatchException', 'Binding method overload is ambiguous');
      if (matches.length) return matches[0];
    }
    return null;
  }

  named(receiver, name) {
    for (const type of this.ancestry(receiver)) {
      const field = type?.fields.get(name);
      const publicField = field && !field.backing && (field.access === undefined || field.access === 'public')
        && (field.flags === undefined || (field.flags & 7) === 6);
      const member = type?.properties.get(name) ?? (publicField ? field : null);
      if (member) return member;
      const getter = type?.methods.get(key('get_' + name, 0))?.[0];
      const setter = type?.methods.get(key('set_' + name, 1))?.[0];
      if (getter || setter) return {kind: 'property', owner: type.name, name, get: getter, set: setter,
        type: getter?.returnType ?? setter.parameters[0]};
    }
    return null;
  }

  byToken(token) {
    const known = this.tokens.get(token);
    if (known) return known;
    const injected = this.context.services?.resolveCompiledToken?.(token, this);
    if (injected) { this.tokens.set(token, injected); return injected; }
    if (this.metadata && token >>> 24 === 10) {
      const descriptor = this.metadata.resolveToken(token);
      const contract = contractForMember({owner: descriptor.owner, name: descriptor.name, signature: descriptor.signature});
      if (contract) return this.cacheToken(token, {...descriptor, kind: 'contract', contract});
      const resolved = descriptor.resolvedToken && this.tokens.get(descriptor.resolvedToken);
      if (resolved) return this.cacheToken(token, resolved);
      if (intrinsicDefinition(descriptor)) return this.cacheToken(token, {...descriptor, kind: 'intrinsic'});
    }
    throw new ManagedFault('MissingMemberException', 'Compiled binding metadata token is not present in this assembly');
  }

  cacheToken(token, descriptor) {
    if (this.tokens.size >= this.maxMembers) throw new ManagedFault('ExecutionLimitException', 'Compiled token cache budget exceeded');
    this.tokens.set(token, descriptor);
    return descriptor;
  }

  native(value, type) { return this.context.properties.toNative(value, canonicalType(type)); }

  managed(value, type = 'object', hint = null) {
    if (isReference(value) || value === null) return value;
    if (type === 'object') {
      const actual = hint && hint !== 'object' ? hint : (typeof value === 'number' ? Number.isInteger(value) ? 'int' : 'double'
        : typeof value === 'boolean' ? 'bool' : typeof value === 'bigint' ? 'long' : typeof value === 'string' ? 'string' : value?.valueType);
      return this.context.properties.toManaged(value, actual ?? type, {box: true});
    }
    return this.context.properties.toManaged(value, type);
  }

  invoke(receiver, method, values, {argumentTypes = []} = {}) {
    if (!method || method.parameters.length !== values.length) throw new ManagedFault('MissingMethodException', 'Binding method signature mismatch');
    const roots = [receiver, ...values];
    return this.platform.heap.withRoots(roots, () => {
      const args = values.map((value, index) => {
        const managed = this.managed(value, method.parameters[index], argumentTypes[index]);
        this.platform.heap.pins.push(managed);
        return managed;
      });
      const result = invokeManagedMethod(this.platform, method.id, method.isStatic ? null : receiver, args);
      return this.native(result, method.returnType);
    });
  }

  invokeContract(receiver, member, values) {
    const signature = member.signature;
    if (signature.parameters.length !== values.length) throw new ManagedFault('MissingMethodException', 'Binding contract signature mismatch');
    if (!member.contract.isStatic && isReference(receiver)) {
      const implementation = this.implementation(receiver, member);
      if (implementation) return this.invoke(receiver, implementation, values);
    }
    return this.platform.heap.withRoots([receiver, ...values], () => {
      const args = values.map((value, index) => {
        const managed = this.managed(value, signature.parameters[index]);
        this.platform.heap.pins.push(managed);
        return managed;
      });
      const result = this.platform.invoke(member.contract, member.contract.isStatic ? args : [receiver, ...args]);
      return this.native(result, signature.returnType);
    });
  }

  invokeToken(receiver, member, values) {
    if (member.kind === 'contract') return this.invokeContract(receiver, member, values);
    if (member.kind !== 'intrinsic') return this.invoke(receiver, member, values);
    if (member.signature.parameters.length !== values.length) throw new ManagedFault('MissingMethodException', 'Compiled intrinsic arity mismatch');
    return this.platform.heap.withRoots([receiver, ...values], () => {
      const args = values.map((value, index) => {
        const managed = this.managed(value, member.signature.parameters[index]);
        this.platform.heap.pins.push(managed);
        return managed;
      });
      const self = member.signature.isStatic ? null : this.managed(receiver, member.owner);
      this.platform.heap.pins.push(self);
      const result = invokeIntrinsic(this.vm, {...member, kind: 'method'}, member.signature.isStatic ? args : [self, ...args]);
      return this.native(result, member.signature.returnType);
    });
  }

  implementation(receiver, member) {
    const signature = member.signature;
    const names = [member.owner + '.' + member.name, member.name];
    for (const type of this.ancestry(receiver)) {
      for (const name of names) {
        const matches = (type?.methods.get(key(name, signature.parameters.length)) ?? []).filter(method => !method.isStatic
          && method.parameters.every((type, index) => canonicalType(type) === canonicalType(signature.parameters[index])));
        if (matches.length > 1) throw new ManagedFault('AmbiguousMatchException', 'Compiled interface implementation is ambiguous');
        if (matches.length) return matches[0];
      }
    }
    return null;
  }

  readField(receiver, member) {
    if (member.isStatic) return this.vm.inspector ? this.vm.statics.get(member.token) : this.vm.statics[member.index];
    const index = this.vm.inspector ? this.vm.typeSystem.field(member.token, receiver).index : member.index;
    return this.platform.heap.get(receiver).data[index];
  }

  writeField(receiver, member, value) {
    if (member.readonly || member.flags & 96) throw new ManagedFault('FieldAccessException', 'Binding source field is read-only');
    const managed = this.managed(value, member.type);
    if (member.isStatic) {
      const oldValue = this.readField(receiver, member);
      if (this.vm.inspector) this.vm.statics.set(member.token, managed);
      else this.vm.statics[member.index] = managed;
      this.vm.notifyWrite({kind: 'static', index: member.token ?? member.index, value: managed, oldValue});
      return value;
    }
    const index = this.vm.inspector ? this.vm.typeSystem.field(member.token, receiver).index : member.index;
    const record = this.platform.heap.get(receiver);
    const oldValue = record.data[index];
    record.data[index] = managed;
    this.vm.notifyWrite({kind: 'field', handle: receiver.h, generation: receiver.g, index, value: managed, oldValue});
    return value;
  }

  read(receiver, member, indexes = []) {
    if (!member) return UnsetValue;
    if (member.kind === 'field') return this.native(this.readField(receiver, member), member.type);
    if (member.kind === 'method') return this.invoke(receiver, member, indexes);
    if (member.kind === 'property' && member.get) return this.invoke(receiver, member.get, indexes);
    if (member.kind === 'contract') return this.invokeContract(receiver, member, indexes);
    if (member.kind === 'intrinsic') return this.invokeToken(receiver, member, indexes);
    throw new ManagedFault('MissingMemberException', 'Binding source member is not readable');
  }

  write(receiver, member, value, indexes = []) {
    if (member?.kind === 'field') return this.writeField(receiver, member, value);
    if (member?.kind === 'property' && member.set) return this.invoke(receiver, member.set, [...indexes, value]);
    if (member?.kind === 'method') return this.invoke(receiver, member, [...indexes, value]);
    if (member?.kind === 'contract') {
      if (member.name.startsWith('get_')) {
        const name = 'set_' + member.name.slice(4);
        const signature = {...member.signature, parameters: [...member.signature.parameters, member.signature.returnType], returnType: 'void'};
        const contract = contractForMember({owner: member.owner, name, signature});
        if (!contract) throw new ManagedFault('MissingMemberException', 'Compiled property setter metadata is unavailable');
        return this.invokeContract(receiver, {...member, name, signature, contract}, [...indexes, value]);
      }
      return this.invokeContract(receiver, member, [...indexes, value]);
    }
    throw new ManagedFault('MissingMemberException', 'Binding source member is not writable');
  }

  isType(value, token) {
    if (!this.metadata) throw new ManagedFault('NotSupportedException', 'Compiled type tests require assembly metadata');
    const name = canonicalType(this.metadata.metadata.typeName(token));
    if (value === null) return false;
    if (!isReference(value)) {
      if (name === 'object') return value !== undefined && value !== UnsetValue;
      if (name === 'string' || name === 'bool') return typeof value === (name === 'bool' ? 'boolean' : 'string');
      if (['double', 'float'].includes(name)) return typeof value === 'number';
      if (['int', 'uint'].includes(name)) return Number.isInteger(value) && (name === 'int'
        ? value >= -2147483648 && value <= 2147483647 : value >= 0 && value <= 4294967295);
      if (['long', 'ulong'].includes(name)) return typeof value === 'bigint' && (name !== 'ulong' || value >= 0n);
      return canonicalType(value?.valueType ?? '') === name;
    }
    const target = this.platform.heap.methodTables.get(name);
    return castCacheFor(this.platform.heap.methodTables).isAssignableFrom(target, this.platform.heap.get(value).methodTable);
  }
}
