import {CilError} from '@sharpforge/cil';
import {defaults,number} from '../numeric-ops.js';

const aliases={'System.Int32':'int','System.UInt32':'uint','System.Int64':'long','System.UInt64':'ulong','System.Boolean':'bool','System.Double':'double','System.Single':'float','System.String':'string','System.Object':'object','System.Char':'char','System.Byte':'byte','System.SByte':'sbyte','System.Int16':'short','System.UInt16':'ushort'};
const handlers=new Map([
  ['newarr',(vm,frame,instruction)=>{
    const length=number(vm.pop()),type=vm.inspector.metadata.typeName(instruction.operand),alias=aliases[type]??type,ref=vm.heap.array(alias,length);
    vm.heap.get(ref).data.fill(defaults(alias));vm.push(ref);
  }],
  ['ldlen',vm=>{const record=vm.heap.get(vm.pop());if(record.kind!=='array')throw new CilError('ldlen requires an array');vm.push(record.data.length);}],
  ['ldelema',vm=>{const index=number(vm.pop()),ref=vm.pop();vm.indexed(ref,index);vm.push(vm.address('array',index,ref));}]
]);
for(const suffix of ['', '.i1','.u1','.i2','.u2','.i4','.u4','.i8','.i','.r4','.r8','.ref']) {
  handlers.set('ldelem'+suffix,(vm,frame,instruction)=>{
    const index=number(vm.pop()),ref=vm.pop(),record=vm.indexed(ref,index);
    vm.push(suffix?vm.indirect(record.data[index],instruction.name):vm.storage(record.data[index],vm.inspector.metadata.typeName(instruction.operand)));
  });
  if(['.u1','.u2','.u4'].includes(suffix))continue;
  handlers.set('stelem'+suffix,(vm,frame,instruction)=>{
    const value=vm.pop(),index=number(vm.pop()),ref=vm.pop();vm.indexed(ref,index);
    vm.dereference(vm.address('array',index,ref),true,suffix?vm.indirect(value,instruction.name):vm.storage(value,vm.inspector.metadata.typeName(instruction.operand)));
  });
}
export {handlers};
