import {CilError} from '@sharpforge/cil';
import {number} from '../numeric-ops.js';
import {createArray,arrayAddress,arrayVectorRecord} from '../arrays.js';

const handlers=new Map([
  ['readonly.',(vm,frame)=>{frame.readonlyAccess=true;}],
  ['newarr',(vm,frame,instruction)=>{
    const length=number(vm.pop()),type=vm.typeSystem.table(instruction.operand);vm.push(createArray(vm,type,[length]));
  }],
  ['ldlen',vm=>{const record=vm.heap.get(vm.pop());if(record.kind!=='array')throw new CilError('ldlen requires an array');vm.push(record.data.length);}],
  ['ldelema',(vm,frame,instruction)=>{const readonly=!!frame.readonlyAccess;frame.readonlyAccess=false;const index=number(vm.pop()),ref=vm.pop();arrayVectorRecord(vm,ref,index);vm.push(arrayAddress(vm,ref,[index],{type:vm.typeSystem.table(instruction.operand),readonly}));}]
]);
for(const suffix of ['', '.i1','.u1','.i2','.u2','.i4','.u4','.i8','.i','.r4','.r8','.ref']) {
  handlers.set('ldelem'+suffix,(vm,frame,instruction)=>{
    const index=number(vm.pop()),ref=vm.pop(),record=arrayVectorRecord(vm,ref,index);
    vm.push(suffix?vm.indirect(record.data[index],instruction.name):vm.storage(record.data[index],vm.inspector.metadata.typeName(instruction.operand)));
  });
  if(['.u1','.u2','.u4'].includes(suffix))continue;
  handlers.set('stelem'+suffix,(vm,frame,instruction)=>{
    const value=vm.pop(),index=number(vm.pop()),ref=vm.pop();arrayVectorRecord(vm,ref,index);
    vm.dereference(vm.address('array',index,ref),true,suffix?vm.indirect(value,instruction.name):vm.storage(value,vm.inspector.metadata.typeName(instruction.operand)));
  });
}
export {handlers};
