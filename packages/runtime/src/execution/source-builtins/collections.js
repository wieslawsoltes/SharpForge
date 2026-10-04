import {ManagedFault} from '../../heap.js';
import {mutateArray} from '../array-ops.js';

function collect(vm) { vm.heap.collect(); return null; }
function totalMemory(vm,args,value) {
  if(value===true)vm.heap.collect();
  return BigInt(vm.heap.stats.liveBytes);
}
function collectionCount(vm,args,value) {
  if(!Number.isInteger(value)||value<0||value>2)throw new ManagedFault('ArgumentOutOfRangeException','GC generation must be between 0 and 2');
  // Every collection in this non-generational heap collects all three generations.
  return vm.heap.stats.collections;
}
function arrayReverse(vm,args) { return mutateArray(vm,'Reverse',args[0]); }
function arraySort(vm,args) { return mutateArray(vm,'Sort',args[0]); }

export const collectionBuiltins=Object.freeze({
  'GC.Collect':collect,
  'GC.GetTotalMemory':totalMemory,
  'GC.CollectionCount':collectionCount,
  'Array.Reverse':arrayReverse,
  'Array.Sort':arraySort
});
