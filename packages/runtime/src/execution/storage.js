import {defaults,storage as numericStorage} from './numeric-ops.js';
import {enumInfo,enumUnderlying} from './enums.js';
import {genericTypeParts, resolveExecutionField} from '@sharpforge/cil';

/** Physical static keys can include a closed generic owner and a thread identity. */
export function staticStorageType(vm, key) {
  const [token, owner] = typeof key === 'string' ? JSON.parse(key) : [key, null];
  return resolveExecutionField(vm.inspector, token, genericTypeParts(owner ?? '').arguments).signature.type;
}

/** CLI enum storage has the width of value__, while its header keeps enum identity. */
export function storageDefault(vm,type) {
  const info=enumInfo(vm,type);
  return info?enumUnderlying(0,info.underlyingType):defaults(type);
}
export function storageValue(vm,value,type,numericContext) {
  // Physical Boolean codecs use host booleans; the CIL evaluation stack represents them as Int32.
  if(typeof value==='boolean'&&(type==='bool'||type==='System.Boolean'))value=Number(value);
  const info=enumInfo(vm,type);
  return info?numericStorage(enumUnderlying(value,info.underlyingType),info.underlyingType,numericContext):numericStorage(value,type,numericContext);
}
