import {analyzeMethod} from '@sharpforge/cil';
import {numericTypeNames,numericTypeName,scalarConvert,decodeScalar,number} from '@sharpforge/bytecode';
import {isReference,ManagedFault} from '../heap.js';
import {isValueTypeValue,copyValue,boxValue} from './value-types.js';
import {enumInfo,enumValue} from './enums.js';
import {storageValue} from './storage.js';
const analyses=new WeakMap();
export function sourceInputTypes(vm,frame=vm.top,pc=frame.pc-1) {
  const method=vm.image.methods[frame.methodId];let entry=analyses.get(method);
  if(!entry||entry.code!==method.code){entry={code:method.code,analysis:analyzeMethod(vm.image,method)};analyses.set(method,entry);}
  return entry.analysis.states[pc]??[];
}
export const sourceCopy=(vm,value)=>isValueTypeValue(value)?copyValue(vm,value):value;
export function sourceStore(vm,value,target,from=null) {
  if(value?.scalar)value=decodeScalar(value,vm.options);
  if(target.endsWith('&'))return storageValue(vm,value,target);
  if(value?.byref)throw new ManagedFault('InvalidProgramException','A managed pointer requires byref storage');
  if(isValueTypeValue(value))return vm.heap.methodTables.get(target).flags.valueType?copyValue(vm,value,target):boxValue(vm,value,value.valueType);
  if(enumInfo(vm,target))return enumValue(vm,target,value);
  if(target==='bool')return !!number(value);
  const scalar=numericTypeName(target);
  if(numericTypeNames.includes(scalar))return scalarConvert(value,numericTypeName(from??target),scalar,false,{...vm.options,fault:(type,message)=>new ManagedFault(type,message)});
  if(value!==null&&!isReference(value)) {
    const type=from??value?.enumType;
    if(type&&vm.heap.methodTables.get(type).flags.valueType)return boxValue(vm,value,type);
  }
  return value;
}
