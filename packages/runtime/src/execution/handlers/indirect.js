import {nativeSize} from '../native-int.js';
import {primitiveSizes} from '@sharpforge/cil';
import {ManagedFault} from '../../heap.js';
import {storageDefault} from '../storage.js';
import {enumInfo} from '../enums.js';
import {finishMemoryAccess} from '../statics.js';

const handlers=new Map([
  ['sizeof',(vm,frame,instruction)=>{const type=vm.inspector.metadata.typeName(instruction.operand);vm.push(type==='System.IntPtr'||type==='System.UIntPtr'?nativeSize(vm.options):primitiveSizes[type]);}],
  ['cpobj',(vm,frame,instruction)=>{const source=vm.pop(),destination=vm.pop(),type=vm.inspector.metadata.typeName(instruction.operand);vm.dereference(destination,true,vm.storage(vm.dereference(source),type));}],
  ['ldobj',(vm,frame,instruction)=>vm.push(vm.storage(vm.dereference(vm.pop()),vm.inspector.metadata.typeName(instruction.operand)))],
  ['stobj',(vm,frame,instruction)=>{const value=vm.pop();vm.dereference(vm.pop(),true,vm.storage(value,vm.inspector.metadata.typeName(instruction.operand)));}],
  ['initobj',(vm,frame,instruction)=>{
    const address=vm.pop(),table=vm.typeSystem.table(instruction.operand),type=table.name;
    if(table.flags.valueType&&!table.flags.primitive&&!primitiveSizes[type]&&!enumInfo(vm,type))throw new ManagedFault('NotSupportedException','Value-type initobj requires T03 value storage');
    vm.dereference(address,true,storageDefault(vm,type));
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
