import { cpus,platform,arch,totalmem } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { resultPath } from './conformance/results.js';
import { compile } from '@sharpforge/compiler';
import { Workspace } from '@sharpforge/workspace';
import { VirtualMachine,ManagedHeap } from '@sharpforge/runtime';
import { samples } from '../apps/studio/samples.js';
const results=[];
function measure(name,action,{iterations=25,warmup=5,batch=1,details={}}={}) {
 const coldStart=performance.now();action();const coldSamples=[performance.now()-coldStart];
 for(let i=0;i<warmup;i++)action();
 const times=[];for(let i=0;i<iterations;i++){const start=performance.now();for(let j=0;j<batch;j++)action();times.push((performance.now()-start)/batch);}
 const sorted=[...times].sort((a,b)=>a-b);const result={rawSamples:[...times],coldSamples,name,iterations,warmup,batch,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)],minMs:sorted[0],maxMs:sorted.at(-1),...details};results.push(result);console.log(`${name}: median ${result.medianMs.toFixed(4)} ms; p95 ${result.p95Ms.toFixed(4)} ms`);
}
function generated(files,statements){return [...Array.from({length:files},(_,i)=>({uri:`Generated${i}.cs`,text:`class Generated${i}\n{\n public static int Calculate(int input)\n {\n  int value=input;\n${Array.from({length:statements},(_,j)=>`  value += ${j%97};`).join('\n')}\n  return value;\n }\n}\n`})),{uri:'Program.cs',text:'Console.WriteLine(Generated0.Calculate(1));\n'}];}
const small=samples[0].files,medium=generated(10,90),large=generated(25,390);
const describe=files=>({files:files.length,lines:files.reduce((n,f)=>n+f.text.split('\n').length-1,0),characters:files.reduce((n,f)=>n+f.text.length,0)});
for(const [name,files]of [['particle project',small],['approximately 1K lines',medium],['approximately 10K lines',large]])measure('full parse + bind + emit: '+name,()=>{const r=compile(files);if(!r.success)throw new Error(JSON.stringify(r.diagnostics));},{iterations:name.includes('10K')?15:25,details:describe(files)});
const workspace=new Workspace();for(const f of large)workspace.update(f.uri,f.text,1);workspace.compile();
measure('unchanged workspace result cache lookup',()=>{const r=workspace.compile();if(!r.success||!r.image)throw Error('Invalid cached compilation');},{batch:1000,details:{...describe(large),note:'Returns the same compilation result; not a recompile.'}});
let version=1;measure('one-file edit in approximately 10K-line workspace',()=>{workspace.update('Program.cs',`Console.WriteLine(Generated0.Calculate(${++version}));\n`,version);const r=workspace.compile();if(!r.success||r.metrics.parsedThisCompilation!==1)throw new Error('Invalid edit workload');},{iterations:15,details:{...describe(large),note:'One file reparsed, all methods rebound and re-emitted; update cost included.'}});
const loop=compile('int sum=0;for(int i=0;i<10000;i++){sum+=i;}Console.WriteLine(sum);').image;
let instructions;measure('VM: 10,000-iteration integer loop',()=>{const vm=new VirtualMachine(loop),r=vm.run();if(r.output!=='49995000\n')throw new Error('Execution mismatch');instructions=r.stats.instructions;},{iterations:15,details:{includes:'VM creation, verification, execution and one output line; no source compilation.'}});
results.at(-1).instructions=instructions;
measure('GC: trace and sweep 10,000-object chain',()=>{const heap=new ManagedHeap({initialThreshold:2_000_000});let head=null;for(let i=0;i<10000;i++)head=heap.object('Node',[head]);heap.rootProvider=()=>[head];heap.collect();head=null;const r=heap.collect();if(r.liveObjects!==0)throw new Error('GC mismatch');},{iterations:15,details:{includes:'Allocation, one live trace, one dead sweep; not a pause-only benchmark.'}});
const report={correctness:{passed:true},recordedAt:new Date().toISOString(),environment:{node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,hostMemoryGiB:Math.round(totalmem()/2**30)},methodology:'Single-process warm microbenchmarks in a shared Linux container. Wall-clock milliseconds, external performance.now(). No forced JS GC, no network, no browser rendering. Not conformance or comparative compiler measurements.',results};
await writeFile(process.env.BENCH_REPORT??await resultPath('benchmark-results.json'),JSON.stringify(report,null,2)+'\n');
