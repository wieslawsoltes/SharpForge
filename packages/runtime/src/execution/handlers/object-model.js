import {numericFieldDefinition} from '@sharpforge/cil';
import {cachedMetadataToken} from '../token-cache.js';
import {decimalConstants} from '../decimal-intrinsics.js';
import {castReference} from '../casting.js';
import {staticSlot,finishMemoryAccess} from '../statics.js';
import {ManagedFault} from '../../heap.js';
import {boxValue,unboxValue,unboxCompatible} from '../value-types.js';
import {fieldAccess,fieldAddress} from '../managed-pointers.js';
import {loadField} from '../field-storage.js';

const handlers=new Map();
handlers.set('volatile.',(vm,frame)=>{frame.volatileAccess=true;});
for(const name of ['ldsfld','stsfld','ldsflda'])handlers.set(name,(vm,frame,instruction)=>{
  const constant=numericFieldDefinition(cachedMetadataToken(vm,instruction.operand));
  if(constant){if(name!=='ldsfld')throw new ManagedFault('InvalidProgramException','Numeric constant fields are read-only');vm.push(decimalConstants[constant.name]);finishMemoryAccess(frame);return;}
  const slot=staticSlot(vm,instruction.operand,frame);
  if(vm.ensureInitialized(slot.typeToken,'field',slot.genericIdentity)){frame.pc--;return;}
  if(name==='ldsfld')vm.push(loadField(vm,vm.statics.get(slot.key),slot.field));
  else if(name==='stsfld')vm.dereference(vm.address('static',slot.key,null,{type:slot.field.signature.type}),true,vm.pop());
  else vm.push(vm.address('static',slot.key,null,{type:slot.field.signature.type}));
  finishMemoryAccess(frame);
});
for(const name of ['ldfld','stfld','ldflda'])handlers.set(name,(vm,frame,instruction)=>{
  const value=name==='stfld'?vm.pop():undefined,ref=vm.pop(),field=fieldAccess(vm,instruction.operand,ref);
  if(name==='stfld')vm.dereference(fieldAddress(vm,instruction.operand,ref,field),true,value);
  else if(name==='ldfld')vm.push(loadField(vm,field.record.data[field.index],field.field));
  else vm.push(fieldAddress(vm,instruction.operand,ref,field));
  finishMemoryAccess(frame);
});
handlers.set('box',(vm,frame,instruction)=>vm.push(boxValue(vm,vm.pop(),vm.typeSystem.table(instruction.operand))));
for(const name of ['unbox','unbox.any'])handlers.set(name,(vm,frame,instruction)=>{
  const ref=vm.pop(),table=vm.typeSystem.table(instruction.operand);
  if(name==='unbox.any'&&!table.flags.valueType){vm.push(castReference(vm.heap,ref,table));return;}
  if(name==='unbox.any'){vm.push(unboxValue(vm,ref,table));return;}
  const record=vm.heap.get(ref);
  if(record.kind!=='box'||!unboxCompatible(record.methodTable,table))throw new ManagedFault('InvalidCastException','Boxed type mismatch');
  vm.push(vm.address('box',0,ref,{type:table}));
});
for(const name of ['castclass','isinst'])handlers.set(name,(vm,frame,instruction)=>{
  vm.push(castReference(vm.heap,vm.pop(),vm.typeSystem.table(instruction.operand),name==='castclass'));
});
export {handlers};
