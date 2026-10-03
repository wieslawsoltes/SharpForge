import {CilError, resolveExecutionField} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';

/** Immutable field metadata scoped to one inspector and closed receiver type.
 * Heap records and handles are never cached: callers must validate them on every access.
 */
export class FieldResolutionCache {
  constructor(typeSystem) {
    this.typeSystem = typeSystem;
    this.withoutReceiver = new Map();
    this.receivers = new WeakMap();
  }

  resolve(token, receiverTable = null) {
    let entries = this.withoutReceiver;
    if (receiverTable !== null) {
      entries = this.receivers.get(receiverTable);
      if (!entries) {
        entries = new Map();
        this.receivers.set(receiverTable, entries);
      }
    }
    if (entries.has(token)) return entries.get(token);

    const argumentsList = receiverTable?.typeArguments.map(type => type.name) ?? [];
    const resolved = resolveExecutionField(this.typeSystem.inspector, token, argumentsList);
    if (resolved.kind !== 'field') throw new CilError('Invalid field token');
    let index;
    if (receiverTable !== null) {
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
