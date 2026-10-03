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
    if (entries.has(token)) return entries.get(token);

    const argumentsList = receiverTable?.typeArguments.map(type => type.name) ?? genericTypeParts(owner ?? '').arguments;
    const resolved = resolveExecutionField(this.typeSystem.inspector, token, argumentsList);
    if (resolved.kind !== 'field') throw new CilError('Invalid field token');
    let index;
    if (receiverTable !== null) {
      if (resolved.ownerInstance !== null && !this.typeSystem.castCache.isAssignableFrom(
        this.typeSystem.table(resolved.ownerInstance), receiverTable)) {
        throw new ManagedFault('InvalidProgramException', 'Field declaring type does not match the receiver');
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
