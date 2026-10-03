import {readMemory, writeMemory} from '../raw-memory.js';
import {sizeOfType} from '../value-layout.js';
import {storageDefault} from '../storage.js';
import {finishMemoryAccess} from '../statics.js';

function read(vm, pointer, type) {
  return pointer?.memoryPointer ? readMemory(vm, pointer, type) : vm.storage(vm.dereference(pointer), type);
}
function write(vm, pointer, value, type) {
  const stored = vm.storage(value, type);
  return pointer?.memoryPointer ? writeMemory(vm, pointer, stored, type) : vm.dereference(pointer, true, stored);
}
const handlers = new Map();
handlers.set('sizeof', (vm, frame, instruction) => vm.push(sizeOfType(vm, instruction.operand)));
handlers.set('cpobj', (vm, frame, instruction) => {
  const source = vm.pop();
  const destination = vm.pop();
  const type = vm.typeSystem.table(instruction.operand);
  vm.heap.withRoots([source, destination], () => write(vm, destination, read(vm, source, type), type));
});
handlers.set('ldobj', (vm, frame, instruction) => {
  const pointer = vm.pop();
  vm.push(vm.heap.withRoots([pointer], () => read(vm, pointer, vm.typeSystem.table(instruction.operand))));
});
handlers.set('stobj', (vm, frame, instruction) => {
  const value = vm.pop();
  const pointer = vm.pop();
  vm.heap.withRoots([value, pointer], () => write(vm, pointer, value, vm.typeSystem.table(instruction.operand)));
});
handlers.set('initobj', (vm, frame, instruction) => {
  const pointer = vm.pop();
  const type = vm.typeSystem.table(instruction.operand);
  vm.heap.withRoots([pointer], () => write(vm, pointer, storageDefault(vm, type), type));
});
const suffixTypes = new Map([
  ['i1', 'sbyte'], ['u1', 'byte'], ['i2', 'short'], ['u2', 'ushort'], ['i4', 'int'], ['u4', 'uint'],
  ['i8', 'long'], ['i', 'nint'], ['r4', 'float'], ['r8', 'double'], ['ref', 'object']
]);
for (const [suffix, type] of suffixTypes) {
  handlers.set('ldind.' + suffix, vm => {
    const pointer = vm.pop();
    vm.push(pointer?.memoryPointer ? readMemory(vm, pointer, type) : vm.indirect(vm.dereference(pointer), 'ldind.' + suffix));
  });
  if (['u1', 'u2', 'u4'].includes(suffix)) continue;
  handlers.set('stind.' + suffix, vm => {
    const value = vm.pop();
    const pointer = vm.pop();
    if (pointer?.memoryPointer) writeMemory(vm, pointer, value, type);
    else vm.dereference(pointer, true, vm.indirect(value, 'stind.' + suffix));
  });
}
for (const [opcode, handler] of handlers) {
  if (!['ldobj', 'stobj'].includes(opcode) && !opcode.startsWith('ldind.') && !opcode.startsWith('stind.')) continue;
  handlers.set(opcode, (vm, frame, instruction) => {
    try { handler(vm, frame, instruction); }
    finally { finishMemoryAccess(frame); delete frame.unalignedAccess; }
  });
}
export {handlers};
