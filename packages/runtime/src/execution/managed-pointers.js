import {cachedField} from './token-cache.js';
import {ManagedFault,isReference} from '../heap.js';
import {checkArrayStore} from './casting.js';
import {frameById} from './frame-lifetimes.js';
import {valueLayout} from './value-layout.js';
import {readMemory,writeMemory,validateMemoryPointer,pointerOffset} from './raw-memory.js';
import {isArrayStorage,storageRead,storageWrite} from './array-storage.js';
import {storageValue} from './storage.js';
import {isValueTypeValue,replaceValueField,copyValue} from './value-types.js';

const invalid=message=>new ManagedFault('InvalidProgramException',message);
function checkPointer(vm,pointer) {
  if(pointer===null)throw new ManagedFault('NullReferenceException','Managed pointer is null');
  if(!vm.snapshotOwner||!pointer?.byref||pointer.vmOwner!==vm.snapshotOwner||!Object.isFrozen(pointer)||!Array.isArray(pointer.path)||!Object.isFrozen(pointer.path))throw invalid('Malformed managed pointer or pointer belongs to another VM');
  if(pointer.baseType&&pointer.baseType.registry!==vm.heap.methodTables)throw invalid('Managed pointer type belongs to another VM');
}
function slot(vm,pointer) {
  checkPointer(vm,pointer);let slots,table,frame;
  const {kind,index,owner}=pointer;
  if(kind==='local'||kind==='arg') {
    frame=frameById(vm,pointer.frameId);slots=kind==='arg'?(frame.args??frame.locals):frame.locals;
    const declared=vm.inspector?vm.slotType(frame,kind==='arg',index):vm.image?.methods[frame.methodId]?.locals[index]?.type;
    const type=declared??frame.varargs?.find(item=>item.index===index)?.type;
    table=type?vm.heap.methodTables.get(type):pointer.baseType;
  } else if(kind==='static') {
    if(vm.statics instanceof Map) {
      if(!vm.statics.has(index))throw invalid('Unknown static slot');
      return {get:()=>vm.statics.get(index),set:value=>vm.statics.set(index,value),table:pointer.baseType};
    }
    slots=vm.statics;table=vm.heap.methodTables.get(vm.image.statics[index]?.type??pointer.baseType);
  } else if(['field','array','box'].includes(kind)) {
    const record=vm.heap.get(owner);
    if(kind==='box'&&(record.kind!=='box'||index!==0))throw invalid('A boxed value address is required');
    if(kind==='array'&&record.kind!=='array')throw invalid('An array address is required');
    if(kind==='field'&&['string','array','box'].includes(record.kind))throw invalid('An object field address is required');
    slots=record.data;table=kind==='box'?record.methodTable:kind==='array'?record.methodTable.elementType:record.methodTable.fields[index]?.type??pointer.baseType;
  } else throw invalid('Unknown managed address kind');
  if(!isArrayStorage(slots)||!Number.isInteger(index)||index<0||index>=slots.length)throw invalid('Invalid managed address slot');
  const get=()=>storageRead(slots,index,table,{source:!!vm.image&&!vm.inspector});
  const set=value=>{
    if(owner)slots=vm.heap.ensureWritable?vm.heap.ensureWritable(owner):vm.heap.get(owner).data;
    storageWrite(slots,index,value);
  };
  return {get,set,table,frame};
}
function leaf(vm,pointer) {
  const base=slot(vm,pointer);let value=base.get(),table=base.table;
  for(const index of pointer.path) {
    if(!isValueTypeValue(value)||!Number.isInteger(index)||index<0||index>=value.fields.length)throw invalid('Interior pointer does not address a struct field');
    table=value.valueType.fields[index].type;value=value.fields[index];
  }
  return {base,value,table};
}

/** A pointer stores an owned location, not a JS frame/array alias. Paths are
 * resolved on every access so replacing an enclosing struct keeps refs valid. */
export function address(vm,kind,index,owner=null,options={}) {
  if(!vm.snapshotOwner)throw invalid('Managed addresses require a VM owner');
  if(owner?.byref) {
    checkPointer(vm,owner);if(kind!=='field')throw invalid('Only fields can extend an interior pointer');
    if (owner.memoryPointer) {
      const field = owner.baseType.fields[index];
      if (!field) throw invalid('Invalid raw struct field index');
      const pointer = pointerOffset(vm, owner, valueLayout(vm, owner.baseType).offsets[index], field.type);
      return Object.freeze({...pointer, readonly: pointer.readonly || !!options.readonly});
    }
    const pointer=Object.freeze({...owner,path:Object.freeze([...owner.path,index]),readonly:owner.readonly||!!options.readonly});
    leaf(vm,pointer);return pointer;
  }
  const pointer=Object.freeze({byref:true,vmOwner:vm.snapshotOwner,kind,index,owner,
    frameId:['arg','local'].includes(kind)?options.frameId??vm.top?.filterOwnerId??vm.top?.id:null,
    baseType:options.type?vm.heap.methodTables.get(options.type):null,
    path:Object.freeze([]),readonly:!!options.readonly});
  slot(vm,pointer);return pointer;
}
export function dereference(vm,pointer,write=false,replacement) {
  if(pointer?.memoryPointer)return write?writeMemory(vm,pointer,replacement):readMemory(vm,pointer);
  const {base,value,table}=leaf(vm,pointer);
  if(!write) {if(value===undefined)throw invalid('Uninitialized address');return value;}
  if(pointer.readonly)throw invalid('Cannot write through a readonly managed pointer');
  if((replacement?.byref||replacement?.span)&&!['arg','local'].includes(pointer.kind))throw invalid('Managed pointers cannot escape into heap or static storage');
  // Callers have already popped operands. Nested copies may allocate private
  // framework values, so keep both the location and replacement rooted.
  const stored=vm.heap.withRoots([pointer,replacement,base.get()],()=>{
    const copied=table?storageValue(vm,replacement,table):copyValue(vm,replacement);
    vm.heap.pins.push(copied);
    if(pointer.kind==='array'&&!pointer.path.length)checkArrayStore(vm.heap,vm.heap.get(pointer.owner),copied);
    const replace=(current,path,at)=>at===path.length?copied:replaceValueField(vm,current,path[at],replace(current.fields[path[at]],path,at+1));
    base.set(replace(base.get(),pointer.path,0));return copied;
  });
  const writeEvent={kind:pointer.kind,index:pointer.index,frameId:pointer.frameId,value:stored,oldValue:value,path:pointer.path,
    ...(pointer.owner?{handle:pointer.owner.h,generation:pointer.owner.g}:{})};
  if(vm.notifyWrite)vm.notifyWrite(writeEvent);
  else {vm.writeRevision=(vm.writeRevision??0)+1;if(pointer.owner)vm.heap.mutationRevision++;vm.onWrite?.(writeEvent);}
  return stored;
}
export function fieldAccess(vm,metadataToken,receiver) {
  const value=receiver?.byref?dereference(vm,receiver):receiver;
  let table,data,boxed=false;
  if(isValueTypeValue(value)){table=value.valueType;if(table.registry!==vm.heap.methodTables)throw invalid('Value belongs to another VM');data=value.fields;}
  else {
    const record=vm.heap.get(value);table=record.methodTable;
    boxed=record.kind==='box'&&isValueTypeValue(record.data[0]);data=boxed?record.data[0].fields:record.data;
  }
  const {field,token,index}=cachedField(vm,metadataToken,table);
  return {field,token,index,record:{methodTable:table,type:table.name,data},receiver,value,boxed};
}
export function fieldAddress(vm,metadataToken,receiver,field=fieldAccess(vm,metadataToken,receiver)) {
  if(isValueTypeValue(receiver))throw invalid('A struct field address requires an addressable receiver');
  const actual=receiver?.byref&&isReference(field.value)?field.value:receiver;
  const owner=field.boxed?address(vm,'box',0,actual):actual;
  return address(vm,'field',field.index,owner,{type:field.record.methodTable.fields[field.index].type});
}

/** Indexed source IR adapters use the same address/copy rules as metadata CIL. */
export function sourceFieldType(vm,receiver,index) {
  const value=receiver?.byref?dereference(vm,receiver):receiver;
  const record=isValueTypeValue(value)?{data:value.fields,methodTable:value.valueType}:vm.heap.get(value);
  if(!Number.isInteger(index)||index<0||index>=record.data.length)throw invalid('Invalid source field index');
  return record.methodTable.fields[index]?.type??vm.heap.methodTables.get('object');
}
export function sourceFieldValue(vm,receiver,index) {
  return vm.heap.withRoots([receiver],()=>{
    const value=receiver?.byref?dereference(vm,receiver):receiver;
    const record=isValueTypeValue(value)?{data:value.fields,methodTable:value.valueType}:vm.heap.get(value);
    return copyValue(vm,record.data[index],sourceFieldType(vm,receiver,index));
  });
}
export function sourceFieldStore(vm,receiver,index,value) {
  return dereference(vm,address(vm,'field',index,receiver),true,value);
}

export function validatePointer(vm,pointer,{write=false,allowUninitialized=false}={}) {
  if(pointer?.memoryPointer){validateMemoryPointer(vm,pointer,{write});return pointer;}
  const {value}=leaf(vm,pointer);
  if(write&&pointer.readonly)throw invalid('Cannot write through a readonly managed pointer');
  if(!allowUninitialized&&value===undefined)throw invalid('Uninitialized address');
  return pointer;
}
export function pointerType(vm,pointer) {return pointer?.memoryPointer?pointer.baseType:leaf(vm,pointer).table;}
export function asReadonly(vm,pointer) {
  validatePointer(vm,pointer,{allowUninitialized:true});
  return Object.freeze({...pointer,readonly:true});
}
