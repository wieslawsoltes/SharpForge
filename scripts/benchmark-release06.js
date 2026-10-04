import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import { resultPath } from './conformance/results.js';
import {cpus,platform,arch} from 'node:os';
import assert from 'node:assert/strict';
import {SyntaxHighlightIndex} from '@sharpforge/editor';
import {compileToIL} from '@sharpforge/compiler';
import {CilDebugSession} from '@sharpforge/debugger';
import {CilVirtualMachine,VirtualMachine} from '@sharpforge/runtime';
const results=[];
function measure(name,fn,{warmups=3,iterations=15,batch=1,details={}}={}){
 const coldStart=performance.now();fn();const coldSamples=[performance.now()-coldStart];
 for(let i=0;i<warmups;i++)fn();const values=[];
 for(let i=0;i<iterations;i++){const start=performance.now();for(let j=0;j<batch;j++)fn();values.push((performance.now()-start)/batch);}
 const rawSamples=[...values];values.sort((a,b)=>a-b);const row={rawSamples,coldSamples,name,p50Ms:values[Math.floor(values.length*.5)],p95Ms:values[Math.min(values.length-1,Math.floor(values.length*.95))],iterations,batch,...details};results.push(row);console.log(name, row.p50Ms.toFixed(4)+' ms p50');
}
const text=Array.from({length:20000},(_,i)=>`int value${i}=${i}; // line ${i}\n`).join('');
measure('Index 20,000 source lines (full lex + bracket map)',()=>{const i=new SyntaxHighlightIndex(text);assert(i.lexed.tokens.length>20000);},{iterations:9,details:{utf16Characters:text.length}});
const index=new SyntaxHighlightIndex(text);let scroll=1000;
measure('Indexed 440px viewport lookup',()=>{const view=index.window({scrollTop:(scroll++%19000)*22,height:440});assert(view.characters<2000);assert(view.runs.length<500);},{batch:1000,details:{totalTokens:index.lexed.tokens.length,note:'DOM painting, native text input and lexical rebuild are excluded.'}});
const source='using var r=new R();int sum=0;for(int i=0;i<100;i++){sum=checked(sum+i);}Console.WriteLine(sum); class R:IDisposable{public void Dispose(){Console.WriteLine("cleanup");}}';
const compiled=compileToIL(source);assert(compiled.success,JSON.stringify(compiled.diagnostics));const expected='4950\ncleanup\n';
measure('Checked/using compile to real PE/CLI',()=>assert(compileToIL(source).success));
measure('Checked/using original IR execution',()=>assert.equal(new VirtualMachine(compiled.image).run().output,expected));
measure('Checked/using direct CIL load + execution',()=>assert.equal(new CilVirtualMachine(compiled.assembly).run().output,expected));
for(const history of [false,true])measure('Direct IL debugger, history '+(history?'on':'off'),()=>{const d=new CilDebugSession(compiled.assembly,{recordHistory:history});d.start(false);d.runUntilStop();assert.equal(d.vm.output.join(''),expected);if(history){assert(d.history.length<=128);assert(d.historyBytes<=8*1024*1024);d.stepBack();assert.equal(d.vm.state,'paused');}},{iterations:9,details:{includes:'Assembly load, interpreter execution, debugger hooks; enabled case also one reverse step.',historyLimit:history?128:0}});
const report={correctness:{passed:true},version:'0.6.0',timestamp:new Date().toISOString(),environment:{node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model},methodology:'Warm single-process microbenchmarks on a shared container. Wall-clock performance.now; no forced GC. Independent workloads, not equivalent cost comparisons. History copies complete managed state and deliberately costs more. Viewport lookup excludes browser painting and full text input.',results};
await writeFile(process.env.BENCH_REPORT??await resultPath('benchmark-results-0.6.0.json'),JSON.stringify(report,null,2)+'\n');
