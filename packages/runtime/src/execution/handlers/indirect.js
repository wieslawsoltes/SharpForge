import {storageDefault} from '../storage.js';
import {finishMemoryAccess} from '../statics.js';

const handlers=new Map([
  ['sizeof',(vm,frame,instruction)=>vm.push(vm.typeSystem.table(instruction.operand).valueSize)],
  ['cpobj',(vm,frame,instruction)=>{const source=vm.pop(),destination=vm.pop(),type=vm.typeSystem.table(instruction.operand);vm.heap.withRoots([source,destination],()=>vm.dereference(destination,true,vm.storage(vm.dereference(source),type)));}],
  ['ldobj',(vm,frame,instruction)=>{const pointer=vm.pop();vm.push(vm.heap.withRoots([pointer],()=>vm.storage(vm.dereference(pointer),vm.typeSystem.table(instruction.operand))));}],
  ['stobj',(vm,frame,instruction)=>{const value=vm.pop(),pointer=vm.pop();vm.heap.withRoots([value,pointer],()=>vm.dereference(pointer,true,vm.storage(value,vm.typeSystem.table(instruction.operand))));}],
  ['initobj',(vm,frame,instruction)=>{
    const address=vm.pop(),type=vm.typeSystem.table(instruction.operand);
    vm.heap.withRoots([address],()=>vm.dereference(address,true,storageDefault(vm,type)));
  }]
]);
for(const suffix of ['i1','u1','i2','u2','i4','u4','i8','i','r4','r8','ref']) {
  handlers.set('ldind.'+suffix,vm=>vm.push(vm.indirect(vm.dereference(vm.pop()),'ldind.'+suffix)));
  if(['u1','u2','u4'].includes(suffix))continue;
  handlers.set('stind.'+suffix,vm=>{const value=vm.pop();vm.dereference(vm.pop(),true,vm.indirect(value,'stind.'+suffix));});
}
for(const [opcode,handler] of handlers)if(['ldobj','stobj'].includes(opcode)||opcode.startsWith('ldind.')||opcode.startsWith('stind.')) {
  handlers.set(opcode,(vm,frame,instruction)=>{try{handler(vm,frame,instruction);}finally{finishMemoryAccess(frame);}});
}
export {handlers};
