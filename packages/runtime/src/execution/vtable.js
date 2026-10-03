import {CilDispatchTable} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {interfaceMap, interfaceTarget} from './interface-map.js';

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

  resolve(typeToken, methodToken) {
    const declaration = this.definition(methodToken);
    const table = this.table(typeToken);
    const target = declaration.flags & 0x40 && this.types.get(declaration.ownerToken)?.flags & 0x20
      ? interfaceTarget(table, this.interfaceMaps.get(table), declaration.ownerToken, declaration.token)
      : super.resolve(typeToken, methodToken);
    if (target?.ambiguousImplementation) {
      throw new ManagedFault('System.Runtime.AmbiguousImplementationException', 'No most-specific interface implementation exists');
    }
    if (this.inspector.methods.get(target)?.flags & 0x400) {
      throw new ManagedFault('MemberAccessException', 'An abstract method has no executable implementation');
    }
    return target;
  }
}
