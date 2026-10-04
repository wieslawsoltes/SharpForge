import {ManagedFault} from '../../heap.js';
import {stackAllocate} from '../stack-memory.js';
import {copyBlock, initializeBlock} from '../raw-memory.js';
import {finishMemoryAccess} from '../statics.js';

const handlers = new Map();
handlers.set('localloc', vm => vm.push(stackAllocate(vm, vm.pop())));
handlers.set('unaligned.', (vm, frame, instruction) => {
  if (![1, 2, 4].includes(instruction.operand)) throw new ManagedFault('InvalidProgramException', 'Invalid memory alignment');
  frame.unalignedAccess = instruction.operand;
});
handlers.set('cpblk', (vm, frame) => {
  const length = vm.pop();
  const source = vm.pop();
  const destination = vm.pop();
  try { copyBlock(vm, destination, source, length); }
  finally { finishMemoryAccess(frame); delete frame.unalignedAccess; }
});
handlers.set('initblk', (vm, frame) => {
  const length = vm.pop();
  const value = vm.pop();
  const destination = vm.pop();
  try { initializeBlock(vm, destination, value, length); }
  finally { finishMemoryAccess(frame); delete frame.unalignedAccess; }
});
export {handlers};
