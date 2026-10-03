import {castReference} from '../casting.js';
import {staticSlot,finishMemoryAccess} from '../statics.js';
import {ManagedFault} from '../../heap.js';
import {boxValue,unboxValue} from '../value-types.js';
import {fieldAccess,fieldAddress} from '../managed-pointers.js';

const handlers=new Map();
handlers.set('volatile.',(vm,frame)=>{frame.volatileAccess=true;});
for(const name of ['ldsfld','stsfld','ldsflda'])handlers.set(name,(vm,frame,instruction)=>{
  const slot=staticSlot(vm,instruction.operand,frame);
  if(vm.ensureInitialized(slot.typeToken,'field',slot.genericIdentity)){frame.pc--;return;}
  if(name==='ldsfld')vm.push(vm.storage(vm.statics.get(slot.key),slot.field.signature.type));
  else if(name==='stsfld')vm.dereference(vm.address('static',slot.key,null,{type:slot.field.signature.type}),true,vm.storage(vm.pop(),slot.field.signature.type));
  else vm.push(vm.address('static',slot.key,null,{type:slot.field.signature.type}));
  finishMemoryAccess(frame);
});
for(const name of ['ldfld','stfld','ldflda'])handlers.set(name,(vm,frame,instruction)=>{
  const value=name==='stfld'?vm.pop():undefined,ref=vm.pop(),field=fieldAccess(vm,instruction.operand,ref);
  if(name==='stfld')vm.dereference(fieldAddress(vm,instruction.operand,ref,field),true,vm.storage(value,field.field.signature.type));
  else if(name==='ldfld')vm.push(vm.storage(field.record.data[field.index],field.field.signature.type));
  else vm.push(fieldAddress(vm,instruction.operand,ref,field));
  finishMemoryAccess(frame);
});
handlers.set('box',(vm,frame,instruction)=>vm.push(boxValue(vm,vm.pop(),vm.typeSystem.table(instruction.operand))));
for(const name of ['unbox','unbox.any'])handlers.set(name,(vm,frame,instruction)=>{
  const ref=vm.pop(),table=vm.typeSystem.table(instruction.operand);
  if(name==='unbox.any'&&!table.flags.valueType){vm.push(castReference(vm.heap,ref,table));return;}
  const record=vm.heap.get(ref);
  if(record.kind!=='box'||record.methodTable!==table)throw new ManagedFault('InvalidCastException','Boxed type mismatch');
  vm.push(name==='unbox'?vm.address('box',0,ref):unboxValue(vm,ref,table));
});
for(const name of ['castclass','isinst'])handlers.set(name,(vm,frame,instruction)=>{
  vm.push(castReference(vm.heap,vm.pop(),instruction.operand,name==='castclass'));
});
export {handlers};
