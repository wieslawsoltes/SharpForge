/** Paired IR/IL microbenchmarks; not a CoreCLR, Roslyn, other-engine or debugger-history comparison. */
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { resultPath } from './conformance/results.js';
import { compile } from '../packages/compiler/src/index.js';
import { emitAssembly, emitAssemblyDetailed, loadAssembly } from '../packages/cil/src/index.js';
import { serializeImage } from '../packages/bytecode/src/index.js';
import { VirtualMachine } from '../packages/runtime/src/index.js';
import { Workspace } from '../packages/workspace/src/index.js';
const quantile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
const stats=values=>({rawSamples:[...values],medianMs:quantile(values,.5),p95Ms:quantile(values,.95),minMs:Math.min(...values),maxMs:Math.max(...values),samples:values.length});
function measured(fn){const start=performance.now(),value=fn();return {value,ms:performance.now()-start};}
function image(source){const r=compile(source);if(!r.success)throw new Error(JSON.stringify(r.diagnostics));return r.image;}
function generate(lines){const files=[];for(let f=0;f<10;f++){const count=Math.floor(lines/10),body=Array.from({length:count},(_,i)=>`x += ${i%100};`).join('\n');files.push({uri:`C${f}.cs`,text:`class C${f}{public static int F(){int x=0;\n${body}\nreturn x;}${f===0?'static void Main(){F();}':''}}`,version:1});}return files;}
const report={correctness:{passed:true},timestamp:new Date().toISOString(),node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,policy:'37 paired alternating-order warm executions per workload; 12 warm build/load samples. VM construction excluded from execution timing. IL load includes canonical verification. No debugger history.',pipeline:[],execution:[]};
for(const lines of [1000,10000]){
 const source=generate(lines);for(let i=0;i<4;i++){const im=image(source);loadAssembly(emitAssembly(im));}
 const compilation=[],emission=[],decoding=[],verification=[],load=[],edit=[],rounds=12;
 let artifact;
 for(let i=0;i<rounds;i++){
  const built=measured(()=>compile(source));if(!built.value.success)throw new Error('Benchmark compilation failed');compilation.push(built.ms);
  const emitted=measured(()=>emitAssemblyDetailed(built.value.image));emission.push(emitted.ms);artifact=emitted.value;
  const loaded=measured(()=>loadAssembly(artifact.bytes));load.push(loaded.ms);decoding.push(loaded.value.il.decodeMs);verification.push(loaded.value.il.verificationMs);
  const workspace=new Workspace();source.forEach(f=>workspace.update(f.uri,f.text,f.version));workspace.compile();workspace.update(source[5].uri,source[5].text.replace('x += 1;','x += 101;'),2);edit.push(measured(()=>workspace.compile()).ms);
 }
 report.pipeline.push({approximateLines:lines,sourceBytes:source.reduce((n,f)=>n+Buffer.byteLength(f.text),0),assemblyBytes:artifact.bytes.length,cilBodyBytes:artifact.metrics.ilBytes,metadataBytes:artifact.metrics.metadataBytes,legacyJsonBytes:Buffer.byteLength(serializeImage(image(source))),compile:stats(compilation),emit:stats(emission),decode:stats(decoding),verification:stats(verification),loadTotal:stats(load),oneFileEditAnalysis:stats(edit)});
 console.log(`Pipeline ${lines} lines: compile ${quantile(compilation,.5).toFixed(2)} ms, emit ${quantile(emission,.5).toFixed(2)} ms, load+verify ${quantile(load,.5).toFixed(2)} ms`);
}
const workloads=[
 ['integer loop','class P{static int Main(){int n=0;for(int i=0;i<20000;i++){n=(n+i)*3;n=n^i;}return n;}}'],
 ['calls and arrays','class P{static int Mix(int x)=>x*3+1;static int Main(){int[] a=new int[128];for(int i=0;i<128;i++)a[i]=i;int n=0;for(int k=0;k<120;k++)foreach(int v in a)n+=Mix(v);return n;}}'],
 ['allocation and collection','class N{public int Value;public N(int v){Value=v;}}class P{static int Main(){int n=0;for(int i=0;i<3000;i++){var a=new N(i);n+=a.Value;if(i%100==0)GC.Collect();}return n;}}']
];
for(const [name,source]of workloads){
 const original=image(source),decoded=loadAssembly(emitAssembly(original));
 const execute=im=>{const vm=new VirtualMachine(im),start=performance.now(),result=vm.run();return {ms:performance.now()-start,result};};
 for(let i=0;i<12;i++){execute(original);execute(decoded);}
 const ir=[],il=[],ratios=[];let sample;
 for(let i=0;i<37;i++){
  let a,b;if(i%2===0){a=execute(original);b=execute(decoded);}else{b=execute(decoded);a=execute(original);}
  if(a.result.state!=='terminated'||b.result.state!=='terminated'||a.result.exitCode!==b.result.exitCode||a.result.output!==b.result.output||a.result.stats.instructions!==b.result.stats.instructions||a.result.stats.heap.allocations!==b.result.stats.heap.allocations)throw new Error('Execution mismatch: '+name);
  ir.push(a.ms);il.push(b.ms);ratios.push(b.ms/a.ms);sample=b.result;
 }
 const result={name,rawPairs:ir.map((ms,i)=>({irMs:ms,ilMs:il[i]})),ir:stats(ir),ilPredecoded:stats(il),medianPairedRatio:quantile(ratios,.5),instructions:sample.stats.instructions,exitCode:sample.exitCode,heapAllocations:sample.stats.heap.allocations,heapCollections:sample.stats.heap.collections};report.execution.push(result);
 console.log(`${name}: IR ${result.ir.medianMs.toFixed(2)} ms, IL-predecoded ${result.ilPredecoded.medianMs.toFixed(2)} ms, paired ratio ${result.medianPairedRatio.toFixed(3)}; ${result.instructions} identical instructions`);
}
await writeFile(process.env.BENCH_REPORT??await resultPath('il-benchmark.json'),JSON.stringify(report,null,2)+'\n');
