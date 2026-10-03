import {storage as numericStorage} from './numeric-ops.js';
import {enumInfo,enumUnderlying} from './enums.js';
import {ManagedFault} from '../heap.js';
import {isAggregateType,isValueTypeValue,copyValue,valueDefault,boxValue} from './value-types.js';

/** All CLI slots share scalar narrowing and aggregate copy boundaries. */
export function storageDefault(vm,type) {return valueDefault(vm,type);}
export function storageValue(vm,value,type,numericContext) {
  const name=typeof type==='string'?type:type.name;
  if(value?.methodPointer&&['nint','System.IntPtr'].includes(name)) {
    if(!Object.isFrozen(value)||value.vmOwner!==vm.snapshotOwner)throw new ManagedFault('InvalidProgramException','Method pointer belongs to another VM or is malformed');
    return value;
  }
  if(name.endsWith('&')) {
    if(value===null)return null;
    if(!value?.byref||value.vmOwner!==vm.snapshotOwner)throw new ManagedFault('InvalidProgramException','Managed pointer belongs to another VM or is malformed');
    return value;
  }
  if(value?.byref)throw new ManagedFault('InvalidProgramException','Managed pointer requires a byref storage location');
  const table=vm.inspector?vm.typeSystem.table(type):vm.heap.methodTables.get(type);
  if(isAggregateType(table)||isValueTypeValue(value))return copyValue(vm,value,table,numericContext);
  const info=enumInfo(vm,name);
  return info?numericStorage(enumUnderlying(value,info.underlyingType),info.underlyingType,numericContext):numericStorage(value,name,numericContext);
}

/** Source IR supplies the static input type where primitive values erase it. */
export function sourceStorageValue(vm,value,type,fromType=null) {
  const target=vm.heap.methodTables.get(type),source=fromType?vm.heap.methodTables.get(fromType):isValueTypeValue(value)?value.valueType:null;
  if(source?.flags.valueType&&!target.flags.valueType)return boxValue(vm,value,source);
  return copyValue(vm,value,target);
}
