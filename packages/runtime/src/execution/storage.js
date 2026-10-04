import {isAggregateType, isValueRecord, createValue} from './value-types.js';
import {resolveCallType} from './generic-calls.js';
import {ManagedFault} from '../heap.js';
import {defaults,storage as numericStorage} from './numeric-ops.js';
import {enumInfo,enumUnderlying} from './enums.js';

/** Physical static keys can include a closed generic owner and a thread identity. */
export function staticStorageType(vm, key) {
  const [token, owner] = typeof key === 'string' ? JSON.parse(key) : [key, null];
  const field = vm.typeSystem.fieldCache.resolve(token, null, owner).field;
  if (field.decimalConstant) throw new ManagedFault('InvalidProgramException', 'Decimal constants are readonly');
  return field.signature.type;
}

/** CLI enum storage has the width of value__, while its header keeps enum identity. */
export function storageDefault(vm,type) {
  if(vm.inspector)type=resolveCallType(vm,type);
  const table=vm.inspector?vm.typeSystem.table(type):null;
  if(table&&isAggregateType(table))return createValue(vm,table);
  const info=enumInfo(vm,type);
  return info?enumUnderlying(0,info.underlyingType):defaults(type,vm.options);
}
export function storageValue(vm,value,type,numericContext) {
  numericContext ??= vm.options;
  if(vm.inspector)type=resolveCallType(vm,type);
  const table=vm.inspector?vm.typeSystem.table(type):null;
  if(table&&isAggregateType(table)) {
    if(value===null)throw new ManagedFault('InvalidCastException','A struct value is required');
    return createValue(vm,table,value);
  }
  if(isValueRecord(value))throw new ManagedFault('InvalidCastException','Struct storage requires its exact value type');
  const info=enumInfo(vm,type);
  return info?numericStorage(enumUnderlying(value,info.underlyingType),info.underlyingType,numericContext):numericStorage(value,type,numericContext);
}
