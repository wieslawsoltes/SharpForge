/** Correctness-gated scalar latency. Fresh VM timings; optional baseline worktree. */
import assert from 'node:assert/strict';
import {compile,compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const workloads=[
  {name:'int32',source:'int value=0;for(int i=0;i<10000;i++){value=unchecked(value+3);}Console.WriteLine(value);',output:'30000\n',baseline:true},
  {name:'int64',source:'long value=0L;for(int i=0;i<10000;i++){value=checked(value+3L);}Console.WriteLine(value);',output:'30000\n'},
  {name:'single',source:'float value=0F;for(int i=0;i<10000;i++){value=value+0.5F;}Console.WriteLine(value);',output:'5000\n'},
  {name:'double',source:'double value=0.0;for(int i=0;i<10000;i++){value=value+0.5;}Console.WriteLine(value);',output:'5000\n',baseline:true},
  {name:'decimal',source:'decimal value=0M;for(int i=0;i<10000;i++){value=value+0.01M;}Console.WriteLine(value);',output:'100.00\n'}
];
const implementations=[{name:'candidate',compile,compileToIL,loadAssembly,VirtualMachine,CilVirtualMachine}];
if(process.argv[2]) {
  const root=resolve(process.argv[2]),compiler=await import(pathToFileURL(resolve(root,'packages/compiler/src/index.js'))),runtime=await import(pathToFileURL(resolve(root,'packages/runtime/src/index.js')));
  const cil=await import(pathToFileURL(resolve(root,'packages/cil/src/index.js')));implementations.push({name:'baseline',...compiler,...runtime,loadAssembly:cil.loadAssembly});
}
const records=[];
for(const workload of workloads)for(const engine of ['source','reloaded','cil'])for(const implementation of implementations) {
  if(implementation.name==='baseline'&&!workload.baseline)continue;
  const buildStart=performance.now(),compiled=engine==='source'?implementation.compile(workload.source):implementation.compileToIL(workload.source),compileMs=performance.now()-buildStart;
  assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const make=()=>engine==='cil'?new implementation.CilVirtualMachine(compiled.assembly):new implementation.VirtualMachine(engine==='reloaded'?implementation.loadAssembly(compiled.assembly):compiled.image);
  const measure=()=>{const start=performance.now(),vm=make(),loaded=performance.now(),result=vm.run(),end=performance.now();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,workload.output);return {loadMs:loaded-start,runMs:end-loaded,totalMs:end-start,managedAllocations:vm.heap.stats.allocations,managedAllocatedBytes:vm.heap.stats.allocatedBytes};};
  const cold=measure();for(let i=0;i<10;i++)measure();
  const samples=[];for(let i=0;i<100;i++)samples.push(measure());
  const percentile=(key,p)=>[...samples].sort((a,b)=>a[key]-b[key])[Math.ceil(samples.length*p)-1][key];
  globalThis.gc?.();const before=process.memoryUsage().heapUsed;const allocation=measure();const hostHeapDelta=process.memoryUsage().heapUsed-before;
  records.push({workload:workload.name,engine,implementation:implementation.name,compileMs,cold,samples:100,warm:{medianMs:percentile('runMs',0.5),p95Ms:percentile('runMs',0.95),p99Ms:percentile('runMs',0.99)},allocations:{managedObjects:allocation.managedAllocations,managedBytes:allocation.managedAllocatedBytes,hostHeapDeltaBytes:hostHeapDelta,hostHeapDeltaIsExactAllocationCount:false},raw:samples});
}
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:new URL('../..',import.meta.url),encoding:'utf8'}).trim();
console.log(JSON.stringify({commit,node:process.version,platform:process.platform,architecture:process.arch,nativeIntBits:32,records},null,2));
