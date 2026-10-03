import {CilDispatchTable} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {interfaceMap} from './interface-map.js';

/** Assembly-owned virtual slots; caches are derived metadata and are never snapshotted. */
export class VirtualDispatch extends CilDispatchTable {
  constructor(inspector) {
    super(inspector);
    this.interfaceMaps = new Map();
  }

  table(type) {
    const table = super.table(type);
    if (!this.interfaceMaps.has(table)) this.interfaceMaps.set(table, interfaceMap(table, this.inspector.methods, this.types));
    return table;
  }

  executable(target) {
    if (target?.ambiguousImplementation) {
      throw new ManagedFault('System.Runtime.AmbiguousImplementationException', 'No most-specific interface implementation exists');
    }
    if (target === undefined || this.inspector.methods.get(target)?.flags & 0x400) {
      throw new ManagedFault('MemberAccessException', 'An abstract method has no executable implementation');
    }
    return target;
  }

  resolve(type, methodToken, ownerInstance = null) {
    return this.executable(super.resolve(type, methodToken, ownerInstance));
  }

  externalTarget(type, descriptor) {
    const target = super.externalTarget(type, descriptor);
    return target === null ? null : this.executable(target);
  }
}
