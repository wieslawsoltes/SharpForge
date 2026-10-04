import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../../heap.js';
import {inspectSourceAddress, readonlySourceAddress} from '../source-addresses.js';

const kinds = Object.freeze(['arg', 'local', 'static', 'array', 'field']);

function address(vm, frame, flags, index) {
  const kind = flags & 255;
  const readonly = !!(flags & 256);
  if (kind === 5) {
    vm.stack.push(readonlySourceAddress(vm, vm.stack.pop()));
    return;
  }
  const options = {readonly};
  let owner = null;
  if (kind === 3) {
    options.type = vm.image.constants[index];
    index = vm.stack.pop();
    owner = vm.stack.pop();
  } else if (kind === 4) owner = vm.stack.pop();
  vm.stack.push(vm.address(kinds[kind], index, owner, options));
}

function exactType(vm, pointer, constant) {
  if (constant < 0) return;
  const expected = vm.heap.methodTables.get(vm.image.constants[constant]);
  const actual = vm.heap.methodTables.get(inspectSourceAddress(vm, pointer).type);
  if (expected !== actual) throw new ManagedFault('InvalidProgramException', 'Indirect source storage type mismatch');
}

function load(vm, frame, type) {
  const pointer = vm.stack.pop();
  exactType(vm, pointer, type);
  vm.stack.push(vm.dereference(pointer));
}

function store(vm, frame, type) {
  const value = vm.stack.pop(), pointer = vm.stack.pop();
  exactType(vm, pointer, type);
  vm.stack.push(vm.dereference(pointer, true, value));
}

/** Source managed storage uses the same frozen location records as calls and snapshots. */
export const sourceAddressHandlers = Object.freeze({
  [Op.ADDRESS]: address,
  [Op.LDIND]: load,
  [Op.STIND]: store
});
