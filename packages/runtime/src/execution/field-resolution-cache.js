import {CilError, genericTypeParts, resolveExecutionField} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';

/** Immutable field metadata scoped to one inspector and closed receiver type.
 * Heap records and handles are never cached: callers must validate them on every access.
 */
export class FieldResolutionCache {
  constructor(typeSystem) {
    this.typeSystem = typeSystem;
  }

  resolve(token, receiverTable = null, owner = null) {
    const vm = this.typeSystem.vm;
    if (this.typeSystem.inspector !== vm.inspector || this.typeSystem.methodTables !== vm.heap.methodTables) {
      throw new ManagedFault('InvalidProgramException', 'Field cache belongs to a replaced type system');
    }
    if (receiverTable !== null && receiverTable.registry !== this.typeSystem.methodTables) {
      throw new ManagedFault('InvalidProgramException', 'Field receiver type belongs to another VM');
    }
    const generation = executionCodeState(vm);
    const cache = generation.fields ??= {withoutReceiver: new Map(), receivers: new WeakMap(), owners: new Map()};
    let entries = cache.withoutReceiver;
    if (receiverTable !== null) {
      entries = cache.receivers.get(receiverTable);
      if (!entries) {
        entries = new Map();
        cache.receivers.set(receiverTable, entries);
      }
    } else if (owner !== null) {
      if (typeof owner !== 'string') throw new CilError('Closed field owner must be a type name');
      entries = cache.owners.get(owner);
      if (!entries) cache.owners.set(owner, entries = new Map());
    }
    const context = vm.top?.method ?? null;
    let contextual = entries.get(context);
    if (!contextual) entries.set(context, contextual = new Map());
    entries = contextual;
    if (entries.has(token)) return entries.get(token);

    const argumentsList = owner !== null ? genericTypeParts(owner).arguments : context?.typeArguments ?? [];
    const resolved = resolveExecutionField(this.typeSystem.inspector, token, argumentsList, context?.methodArguments ?? []);
    if (resolved.kind !== 'field') throw new CilError('Invalid field token');
    let index;
    if (receiverTable !== null) {
      if (resolved.ownerInstance !== null && !this.typeSystem.castCache.isAssignableFrom(
        this.typeSystem.table(resolved.ownerInstance), receiverTable)) {
        throw new ManagedFault('InvalidProgramException', 'Field declaring type does not match the receiver');
      }
      let declaring = receiverTable;
      while (declaring && declaring.definitionToken !== resolved.ownerToken) declaring = declaring.base;
      if (!declaring) throw new ManagedFault('InvalidProgramException', 'Field declaring type does not match the receiver');
      const slot = declaring.declaredFields.find(field => field.token === resolved.resolvedToken);
      if (!slot) throw new ManagedFault('InvalidProgramException', 'Field is not part of its declaring type');
      // A closed MemberRef already owns its substituted storage signature. Only an
      // open FieldDef takes the receiver's declaring instantiation as its context.
      if (resolved.ownerInstance === null) {
        resolved.signature = {...resolved.signature, type: slot.storageType ?? slot.type.name};
        resolved.ownerInstance = declaring.typeArguments.length ? declaring.name : null;
        resolved.genericArguments = declaring.typeArguments.map(type => type.name);
      }
      index = this.typeSystem.layout(receiverTable).index.get(resolved.resolvedToken);
      if (index === undefined) {
        throw new ManagedFault('InvalidProgramException', 'Field is not part of this object');
      }
    }
    const field = Object.freeze({
      ...resolved,
      signature: Object.freeze({...resolved.signature}),
      genericArguments: Object.freeze([...resolved.genericArguments])
    });
    const entry = Object.freeze({
      field,
      token: field.resolvedToken,
      ...(receiverTable === null ? {} : {index})
    });
    entries.set(token, entry);
    return entry;
  }
}
