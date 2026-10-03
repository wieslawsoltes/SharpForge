import {CilDispatchTable} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';

/** Runtime adapter over the verifier's assembly-owned declaration tables. */
export class VirtualDispatch extends CilDispatchTable {
  resolve(typeToken, methodToken) {
    const target = super.resolve(typeToken, methodToken);
    if (this.inspector.methods.get(target)?.flags & 0x400) {
      throw new ManagedFault('MemberAccessException', 'An abstract method has no executable implementation');
    }
    return target;
  }
}
