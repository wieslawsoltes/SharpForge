import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
const workloads={
 dictionary:`var d=new Dictionary<int,int>();for(int i=0;i<3000;i++)d.Add(i,i+1);int sum=0;for(int i=0;i<3000;i++)sum+=d[i];Console.WriteLine(sum);`,
 list:`var a=new List<int>();for(int i=0;i<6000;i++)a.Add(i);int sum=0;for(int i=0;i<6000;i++){a[i]+=1;sum+=a[i];}Console.WriteLine(sum);`,
 queue:`var q=new Queue<int>();for(int i=0;i<4000;i++)q.Enqueue(i);int sum=0;while(q.Count>0)sum+=q.Dequeue();Console.WriteLine(sum);`,
 builder:`var b=new StringBuilder();for(int i=0;i<4000;i++)b.Append("ab");Console.WriteLine(b.Length);`
};
const results=[];
for(const [name,source]of Object.entries(workloads)){
 const c=compileToIL('using System;using System.Collections.Generic;using System.Text;'+source);if(!c.success)throw Error(JSON.stringify(c.diagnostics));
 for(const [engine,VM]of [['source',VirtualMachine],['cil',CilVirtualMachine]]){
  const times=[],coldSamples=[];let output,alloc;
  for(let i=0;i<5;i++){const vm=new VM(engine==='source'?c.image:c.assembly,{maxInstructions:20_000_000}),t=performance.now(),r=vm.run();const ms=performance.now()-t;if(r.state!=='terminated')throw Error(JSON.stringify(r));output=r.output;if(output!==({dictionary:'4501500\n',list:'18003000\n',queue:'7998000\n',builder:'8000\n'})[name])throw Error('Incorrect '+name+' output');alloc=vm.heap.stats.allocatedBytes;if(i)times.push(ms);else coldSamples.push(ms);}
  const rawSamples=[...times];times.sort((a,b)=>a-b);results.push({rawSamples,coldSamples,name,engine,medianMs:(times[1]+times[2])/2,allocatedBytes:alloc,output});
 }
}
console.log(JSON.stringify({correctness:{passed:true},node:process.version,results},null,2));
