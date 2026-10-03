import {analyzeMethod} from '@sharpforge/cil';
import {numericTypeNames,numericTypeName,scalarConvert,decodeScalar,number} from '@sharpforge/bytecode';
import {isReference,ManagedFault} from '../heap.js';
import {isValueTypeValue,copyValue,boxValue,valueDefault} from './value-types.js';
import {enumInfo,enumValue} from './enums.js';
import {storageValue} from './storage.js';
const analyses=new WeakMap();
export function sourceInputTypes(vm,frame=vm.top,pc=frame.pc-1) {
  const method=vm.image.methods[frame.methodId];let entry=analyses.get(method);
  if(!entry||entry.code!==method.code){entry={code:method.code,analysis:analyzeMethod(vm.image,method)};analyses.set(method,entry);}
  return entry.analysis.states[pc]??[];
}
export function sourceCopy(vm,value) {
  if(isValueTypeValue(value))return copyValue(vm,value);
  if(isReference(value)){const record=vm.heap.get(value);if(record.kind==='value'&&record.methodTable.flags.valueType)return copyValue(vm,value,record.methodTable);}
  return value;
}
export function sourceNewObject(vm,type) {
  const table=vm.heap.methodTables.get(type);
  if(table.flags.valueType)return valueDefault(vm,table);
  return vm.heap.withRoots([],()=>{
    const fields=table.fields.map(field=>{const value=valueDefault(vm,field.type);vm.heap.pins.push(value);return value;});
    return vm.heap.object(table,fields);
  });
}
export function sourceStore(vm,value,target,from=null) {
  target=typeof target==='string'?target:target.name;
  if(value?.scalar)value=decodeScalar(value,vm.options);
  if(target.endsWith('&'))return storageValue(vm,value,target);
  if(value?.byref)throw new ManagedFault('InvalidProgramException','A managed pointer requires byref storage');
  if(isValueTypeValue(value))return vm.heap.methodTables.get(target).flags.valueType?copyValue(vm,value,target):boxValue(vm,value,value.valueType);
  if(enumInfo(vm,target))return enumValue(vm,target,value);
  if(numericTypeName(target)==='bool')return typeof value==='boolean'?value:!!number(value);
  const scalar=numericTypeName(target);
  if(numericTypeNames.includes(scalar))return scalarConvert(value,numericTypeName(from??target),scalar,false,{...vm.options,fault:(type,message)=>new ManagedFault(type,message)});
  if(value!==null&&!isReference(value)) {
    const type=value?.enumType??from;
    if(type&&vm.heap.methodTables.get(type).flags.valueType)return boxValue(vm,value,type);
  }
  return copyValue(vm,value,target);
}
