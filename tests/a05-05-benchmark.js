// Run only after the complete E01 implementation has been assembled.
import {performance} from 'node:perf_hooks';
import {ManagedHeap} from '@sharpforge/runtime';
import {createArray,arrayGet,arraySet,arrayAddress} from '../packages/runtime/src/execution/arrays.js';
import {dereference} from '../packages/runtime/src/execution/managed-pointers.js';

const vm={heap:new ManagedHeap(),snapshotOwner:Object.freeze({}),frames:[],options:{}};
const ref=createArray(vm,'int',[32,32],[-16,-16]);vm.heap.rootProvider=()=>[ref];
const pointer=arrayAddress(vm,ref,[0,0]),quantile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)];
const results=[];
for(const [name,action] of [['allocate-8x8',()=>createArray(vm,'int',[8,8])],['rectangular-get',()=>arrayGet(vm,ref,[0,0])],['rectangular-set',()=>arraySet(vm,ref,[0,0],7)],['interior-write',()=>dereference(vm,pointer,true,9)]]) {
  const memory=process.memoryUsage().heapUsed,allocations=vm.heap.stats.allocations,coldStart=performance.now();action();const coldMs=performance.now()-coldStart;
  for(let i=0;i<1000;i++)action();const samples=[];
  for(let sample=0;sample<100;sample++){const start=performance.now();for(let i=0;i<1000;i++)action();samples.push((performance.now()-start)/1000);}
  results.push({name,coldMs,warmMedianMs:quantile(samples,.5),p95Ms:quantile(samples,.95),p99Ms:quantile(samples,.99),operations:101001,managedAllocations:vm.heap.stats.allocations-allocations,observedHostHeapDeltaBytes:process.memoryUsage().heapUsed-memory});
}
process.stdout.write(JSON.stringify({node:process.version,platform:process.platform,architecture:process.arch,results},null,2)+'\n');
