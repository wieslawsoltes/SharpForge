import {createArray, arrayAddress, arrayVectorRecord} from '../arrays.js';
import {storageRead} from '../array-storage.js';
import {CilError} from '@sharpforge/cil';
import {arrayInteger} from '../array-limits.js';
import {nativeInteger} from '../native-int.js';
import {finishMemoryAccess} from '../statics.js';

const handlers = new Map([
  ['newarr', (vm, frame, instruction) => vm.push(createArray(vm, vm.typeSystem.table(instruction.operand), [vm.pop()]))],
  ['ldlen', vm => {
    const record = vm.heap.get(vm.pop());
    if (record.kind !== 'array') throw new CilError('ldlen requires an array');
    vm.push(nativeInteger(record.data.length, vm.options.nativeIntBits));
  }],
  ['readonly.', (vm, frame) => { frame.readonlyAccess = true; }],
  ['ldelema', (vm, frame, instruction) => {
    const index = arrayInteger(vm.pop()), reference = vm.pop();
    arrayVectorRecord(vm, reference, index);
    vm.push(arrayAddress(vm, reference, [index], {type: vm.typeSystem.table(instruction.operand), readonly: !!frame.readonlyAccess}));
  }]
]);

for (const suffix of ['', '.i1', '.u1', '.i2', '.u2', '.i4', '.u4', '.i8', '.i', '.r4', '.r8', '.ref']) {
  handlers.set('ldelem' + suffix, (vm, frame, instruction) => {
    const index = arrayInteger(vm.pop()), reference = vm.pop(), record = arrayVectorRecord(vm, reference, index);
    const value = storageRead(record.data, index, record.methodTable.elementType);
    vm.push(suffix ? vm.indirect(value, instruction.name) : vm.storage(value, vm.inspector.metadata.typeName(instruction.operand)));
  });
  if (['.u1', '.u2', '.u4'].includes(suffix)) continue;
  handlers.set('stelem' + suffix, (vm, frame, instruction) => {
    const value = vm.pop(), index = arrayInteger(vm.pop()), reference = vm.pop();
    arrayVectorRecord(vm, reference, index);
    const stored = suffix ? vm.indirect(value, instruction.name) : vm.storage(value, vm.inspector.metadata.typeName(instruction.operand));
    vm.dereference(vm.address('array', index, reference), true, stored);
  });
}

for (const [opcode, handler] of handlers) {
  if (opcode === 'readonly.' || opcode === 'newarr' || opcode === 'ldlen') continue;
  handlers.set(opcode, (vm, frame, instruction) => {
    try { handler(vm, frame, instruction); }
    finally { finishMemoryAccess(frame); }
  });
}

export {handlers};
