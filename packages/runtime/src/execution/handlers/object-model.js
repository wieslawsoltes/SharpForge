import {isDecimal} from '../decimal.js';
import {loadFieldValue} from '../field-storage.js';
import {castReference} from '../casting.js';
import {staticSlot,finishMemoryAccess} from '../statics.js';
import {frameworkType} from '@sharpforge/framework';
import {ManagedFault,isReference} from '../../heap.js';
import {isNumber} from '../numeric-ops.js';

const handlers=new Map();
handlers.set('volatile.',(vm,frame)=>{frame.volatileAccess=true;});
for(const name of ['ldsfld','stsfld','ldsflda'])handlers.set(name,(vm,frame,instruction)=>{
  const slot=staticSlot(vm,instruction.operand,frame);
  if(vm.ensureInitialized(slot.typeToken,'field',slot.genericIdentity)){frame.pc--;return;}
  if(name==='ldsfld')vm.push(loadFieldValue(vm,slot.field,vm.statics.get(slot.key)));
  else if(name==='stsfld')vm.dereference(vm.address('static',slot.key),true,vm.storage(vm.pop(),slot.field.signature.type));
  else vm.push(vm.address('static',slot.key));
  finishMemoryAccess(frame);
});
for(const name of ['ldfld','stfld','ldflda'])handlers.set(name,(vm,frame,instruction)=>{
  const value=name==='stfld'?vm.pop():undefined,ref=vm.pop(),field=vm.field(instruction.operand,ref);
  if(name==='stfld')vm.dereference(vm.address('field',field.index,ref),true,vm.storage(value,field.field.signature.type));
  else if(name==='ldfld')vm.push(loadFieldValue(vm,field.field,field.record.data[field.index]));
  else vm.push(vm.address('field',field.index,ref));
  finishMemoryAccess(frame);
});
handlers.set('box',(vm,frame,instruction)=>{
  const value=vm.pop(),table=vm.typeSystem.table(instruction.operand),type=table.name;
  if(!table.flags.valueType){vm.push(castReference(vm.heap,value,table));return;}
  if(isReference(value)&&frameworkType(type)?.kind==='value'&&vm.heap.get(value).type===type) {
    vm.heap.withRoots([value],()=>{const record=vm.heap.get(value),copy=vm.heap.allocate(record.kind,record.type,[...record.data]);vm.push(vm.heap.allocate('box',table,[copy],[copy]));});return;
  }
  if(isDecimal(value)&&type!=='System.Decimal')throw new ManagedFault('InvalidProgramException','Decimal boxing requires its declared type');
  if(!isNumber(value)&&!isDecimal(value))throw new ManagedFault('NotSupportedException','Only numeric and registered immutable WinUI value boxing is implemented');
  vm.push(vm.heap.allocate('box',table,[vm.storage(value,type)]));
});
for(const name of ['unbox','unbox.any'])handlers.set(name,(vm,frame,instruction)=>{
  const ref=vm.pop(),table=vm.typeSystem.table(instruction.operand),type=table.name;
  if(name==='unbox.any'&&!table.flags.valueType){vm.push(castReference(vm.heap,ref,table));return;}
  const record=vm.heap.get(ref);
  if(record.kind!=='box'||record.methodTable!==table)throw new ManagedFault('InvalidCastException','Boxed type mismatch');
  vm.push(name==='unbox'?vm.address('box',0,ref):vm.storage(record.data[0],type));
});
for(const name of ['castclass','isinst'])handlers.set(name,(vm,frame,instruction)=>{
  vm.push(castReference(vm.heap,vm.pop(),vm.typeSystem.table(instruction.operand),name==='castclass'));
});
export {handlers};
