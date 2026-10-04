import {CilDispatchTable} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {interfaceMap} from './interface-map.js';

/** Runtime adapter over the verifier's assembly-owned declaration tables. */
export class VirtualDispatch extends CilDispatchTable {
  constructor(inspector) {
    super(inspector);
    this.interfaceMaps = new Map();
  }

  table(typeToken) {
    const table = super.table(typeToken);
    if (table.targets && !this.interfaceMaps.has(table)) {
      this.interfaceMaps.set(table, interfaceMap(table, this.inspector.methods, this.types));
    }
    return table;
  }

  resolve(typeToken, methodToken, ownerInstance = null) {
    const declaration = this.definition(methodToken);
    const table = this.table(typeToken);
    const target = super.resolve(typeToken, methodToken, ownerInstance);
    if (target?.ambiguousImplementation) {
      throw new ManagedFault('System.Runtime.AmbiguousImplementationException', 'No most-specific interface implementation exists');
    }
    if (this.inspector.methods.get(target)?.flags & 0x400) {
      throw new ManagedFault('MemberAccessException', 'An abstract method has no executable implementation');
    }
    return target;
  }
}
