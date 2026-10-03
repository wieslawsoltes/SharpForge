import {storage as numericStorage,number} from './numeric-ops.js';
import {enumInfo,enumUnderlying,enumValue} from './enums.js';
import {ManagedFault} from '../heap.js';
import {isAggregateType,isValueTypeValue,copyValue,valueDefault,boxValue} from './value-types.js';

/** All CLI slots share scalar narrowing and aggregate copy boundaries. */
export function storageDefault(vm,type) {return valueDefault(vm,type);}
export function storageValue(vm,value,type,numericContext) {
  numericContext??=vm.options;
  const name=typeof type==='string'?type:type.name;
  if(value?.memoryPointer&&(name.endsWith('*')||['nint','nuint','System.IntPtr','System.UIntPtr'].includes(name))) {
    if(!Object.isFrozen(value)||value.vmOwner!==vm.snapshotOwner)throw new ManagedFault('InvalidProgramException','Foreign native address');
    return value;
  }
  if(value?.span) {
    const spanType=vm.heap.methodTables.get(type);
    if(!spanType.flags.refStruct||spanType.typeArguments[0]!==value.elementType||value.vmOwner!==vm.snapshotOwner)throw new ManagedFault('InvalidProgramException','Invalid Span storage');
    return value;
  }
  if(value?.methodPointer&&(['nint','System.IntPtr'].includes(name)||/^method /.test(name))) {
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
  if(vm.image&&!vm.inspector&&table.name==='System.Boolean')return typeof value==='boolean'?value:!!number(value);
  if(table.flags.nullable||value?.nullableType||isAggregateType(table)||isValueTypeValue(value))return copyValue(vm,value,table,numericContext);
  const info=enumInfo(vm,name);
  if(info&&vm.image&&!vm.inspector)return enumValue(vm,name,value);
  return info?numericStorage(enumUnderlying(value,info.underlyingType),info.underlyingType,numericContext):numericStorage(value,name,numericContext);
}

/** Source IR supplies the static input type where primitive values erase it. */
export function sourceStorageValue(vm,value,type,fromType=null) {
  const target=vm.heap.methodTables.get(type),source=fromType?vm.heap.methodTables.get(fromType):isValueTypeValue(value)?value.valueType:null;
  if(source?.flags.valueType&&!target.flags.valueType)return boxValue(vm,value,source);
  return copyValue(vm,value,target);
}
