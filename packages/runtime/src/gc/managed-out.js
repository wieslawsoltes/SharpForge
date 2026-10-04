import {ManagedFault} from './fault.js';
import {writeArrayReferenceCell} from './byref-array.js';

export function resolveManagedReceiver(platform, argument) {
  return argument?.byref ? platform.vm.dereference(argument) : argument;
}

/** Source uses local or declared owner/index cells; foreign CIL keeps its verified managed-address ABI. */
export function writeManagedOut(platform, address, value) {
  if (address?.byref) {
    if (platform.vm.writeAddress) platform.vm.writeAddress(address, value);
    else platform.vm.dereference(address, true, value);
    return;
  }
  const record = platform.heap.get(address);
  if (writeArrayReferenceCell(platform, address, record, value)) return;
  if (record.kind !== 'object' || record.data.length !== 1) {
    throw new ManagedFault('InvalidProgramException', 'A managed out-parameter cell or byref is required');
  }
  platform.heap.writeField(address, 0, value);
}
