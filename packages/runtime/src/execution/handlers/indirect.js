import {sizeOfType} from '../value-layout.js';
import {storageDefault} from '../storage.js';
import {finishMemoryAccess} from '../statics.js';
import {readMemory, writeMemory} from '../raw-memory.js';

function load(vm, address, type) {
  return address?.memoryPointer ? readMemory(vm, address, type) : vm.storage(vm.dereference(address), type);
}

function store(vm, address, value, type) {
  return address?.memoryPointer ? writeMemory(vm, address, vm.storage(value, type), type)
    : vm.dereference(address, true, vm.storage(value, type));
}

const handlers = new Map([
  ['sizeof', (vm, frame, instruction) => vm.push(sizeOfType(vm, instruction.operand))],
  ['cpobj', (vm, frame, instruction) => {
    const source = vm.pop(), destination = vm.pop(), type = vm.typeSystem.table(instruction.operand);
    store(vm, destination, load(vm, source, type), type);
  }],
  ['ldobj', (vm, frame, instruction) => vm.push(load(vm, vm.pop(), vm.typeSystem.table(instruction.operand)))],
  ['stobj', (vm, frame, instruction) => {
    const value = vm.pop();
    store(vm, vm.pop(), value, vm.typeSystem.table(instruction.operand));
  }],
  ['initobj', (vm, frame, instruction) => {
    const address = vm.pop(), table = vm.typeSystem.table(instruction.operand);
    store(vm, address, storageDefault(vm, table), table);
  }]
]);

const indirectTypes = new Map([
  ['i1', 'sbyte'], ['u1', 'byte'], ['i2', 'short'], ['u2', 'ushort'], ['i4', 'int'], ['u4', 'uint'],
  ['i8', 'long'], ['i', 'nint'], ['r4', 'float'], ['r8', 'double'], ['ref', 'object']
]);
for (const [suffix, type] of indirectTypes) {
  handlers.set('ldind.' + suffix, vm => {
    const address = vm.pop();
    const value = address?.memoryPointer ? readMemory(vm, address, type) : vm.dereference(address);
    vm.push(suffix === 'i' && value?.memoryPointer ? vm.storage(value, 'nint') : vm.indirect(value, 'ldind.' + suffix));
  });
  if (['u1', 'u2', 'u4'].includes(suffix)) continue;
  handlers.set('stind.' + suffix, vm => {
    const input = vm.pop();
    const value = suffix === 'i' && input?.memoryPointer ? vm.storage(input, 'nint') : vm.indirect(input, 'stind.' + suffix);
    const address = vm.pop();
    if (address?.memoryPointer) writeMemory(vm, address, value, type);
    else vm.dereference(address, true, value);
  });
}

for (const [opcode, handler] of handlers) {
  if (opcode === 'sizeof') continue;
  handlers.set(opcode, (vm, frame, instruction) => {
    try { handler(vm, frame, instruction); }
    finally { finishMemoryAccess(frame); }
  });
}
export {handlers};
