// Run only after the complete E01 implementation is assembled.
// Measures helper latency and observed allocations; not a native CLR qualification.
import {performance} from 'node:perf_hooks';
import {ManagedHeap} from '@sharpforge/runtime';
import {MethodTableRegistry} from '../packages/runtime/src/execution/method-table.js';
import {createValue,copyValue,boxValue} from '../packages/runtime/src/execution/value-types.js';
import {address,dereference} from '../packages/runtime/src/execution/managed-pointers.js';

const registry=new MethodTableRegistry().define({name:'Pair',base:'System.ValueType',flags:{valueType:true},fields:[{name:'A',type:'int'},{name:'B',type:'string'}]});
const vm={heap:new ManagedHeap({methodTables:registry}),snapshotOwner:Object.freeze({}),frames:[{id:1,locals:[],args:[]}],statics:new Map(),writeRevision:0};
Object.defineProperty(vm,'top',{get:()=>vm.frames[0]});vm.top.locals=[createValue(vm,'Pair',[1,null])];vm.heap.rootProvider=()=>vm.top.locals;
const pointer=address(vm,'field',0,address(vm,'local',0,null,{type:'Pair'}));
const quantile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
const results=[];
for(const [name,action] of [['copy',()=>copyValue(vm,vm.top.locals[0])],['interior-write',()=>dereference(vm,pointer,true,2)],['box',()=>boxValue(vm,vm.top.locals[0],'Pair')]]) {
  const memory=process.memoryUsage().heapUsed,allocations=vm.heap.stats.allocations,coldStart=performance.now();action();const coldMs=performance.now()-coldStart;
  for(let i=0;i<1000;i++)action();const samples=[];
  for(let sample=0;sample<100;sample++){const start=performance.now();for(let i=0;i<1000;i++)action();samples.push((performance.now()-start)/1000);}
  results.push({name,coldMs,warmMedianMs:quantile(samples,.5),p95Ms:quantile(samples,.95),p99Ms:quantile(samples,.99),operations:101001,managedAllocations:vm.heap.stats.allocations-allocations,observedHostHeapDeltaBytes:process.memoryUsage().heapUsed-memory});
}
process.stdout.write(JSON.stringify({node:process.version,platform:process.platform,architecture:process.arch,results},null,2)+'\n');
