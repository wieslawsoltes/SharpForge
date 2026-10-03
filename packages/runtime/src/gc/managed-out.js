import {ManagedFault} from './fault.js';

export function resolveManagedReceiver(platform, argument) {
  return argument?.byref ? platform.vm.dereference(argument) : argument;
}

/** The source ABI uses one-slot cells; foreign CIL uses verified managed addresses. */
export function writeManagedOut(platform, address, value) {
  if (address?.byref) {
    if (platform.vm.writeAddress) platform.vm.writeAddress(address, value);
    else platform.vm.dereference(address, true, value);
    return;
  }
  const record = platform.heap.get(address);
  if (record.kind !== 'object' || record.data.length !== 1) {
    throw new ManagedFault('InvalidProgramException', 'A managed out-parameter cell or byref is required');
  }
  platform.heap.writeField(address, 0, value);
}
