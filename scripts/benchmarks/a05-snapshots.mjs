import {execFileSync} from 'node:child_process';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
const c=compileToIL('class P {static int F(int x){return x==0?0:F(x-1)+1;}static void Main(){Console.WriteLine(F(20));}}');
if(!c.success)throw new Error(JSON.stringify(c.diagnostics));
const percentile=(samples,p)=>[...samples].sort((a,b)=>a-b)[Math.min(samples.length-1,Math.ceil(p*samples.length)-1)];
const results=[];
for(const vm of [new VirtualMachine(c.image),new CilVirtualMachine(c.assembly)]) {
  while(vm.frames.length<12)vm.runSlice({instructionBudget:1,timeBudgetMs:1000});
  const before=vm.heap.stats.allocations,firstStart=performance.now(),saved=vm.snapshot();vm.restore(saved);const coldMs=performance.now()-firstStart;
  const samples=[];for(let i=0;i<110;i++){const start=performance.now(),s=vm.snapshot();vm.restore(s);if(i>=10)samples.push(performance.now()-start);}
  if(vm.run().output!=='20\n')throw new Error('Replay correctness failed');
  results.push({engine:vm.constructor.name,coldMs,medianMs:percentile(samples,.5),p95Ms:percentile(samples,.95),p99Ms:percentile(samples,.99),samples,managedAllocationsDuringSnapshots:vm.heap.stats.allocations-before});
}
console.log(JSON.stringify({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,platform:process.platform,architecture:process.arch,measurement:'Fresh snapshot/restore in an existing process; host graph allocation is not included in managed heap allocation count',results},null,2));
