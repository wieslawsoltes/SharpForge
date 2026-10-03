import {ManagedFault} from '../heap.js';
import {defaultStringOrdering} from '@sharpforge/bcl-core';

/** Shared source/CIL ordering for the registered one-dimensional array operations. */
export function mutateArray(vm,name,reference) {
  if(reference===null)throw new ManagedFault('ArgumentNullException','Array cannot be null');
  const record=vm.heap.get(reference);
  if(record.kind!=='array')throw new ManagedFault('ArgumentException','Array required');
  if(name==='Reverse')record.data.reverse();
  else if(name==='Sort')record.data.sort((left,right)=>{
    const a=vm.value(left),b=vm.value(right);
    if(a===null||b===null)return a===b?0:a===null?-1:1;
    if(typeof a==='number'&&typeof b==='number')return Number.isNaN(a)?Number.isNaN(b)?0:-1:Number.isNaN(b)?1:a<b?-1:a>b?1:0;
    if(typeof a==='bigint'&&typeof b==='bigint'||typeof a==='boolean'&&typeof b==='boolean')return a<b?-1:a>b?1:0;
    return defaultStringOrdering(vm.platform??vm).compare(String(a),String(b));
  });
  else throw new ManagedFault('MissingMethodException','Unsupported array operation');
  vm.heap.mutationRevision++;return null;
}
