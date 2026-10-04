import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm,symlink,readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {loadCorpus,loadFixture,hydrateFixture,fixtureHash,limits,corpusRoot} from '../../../scripts/conformance/diff/fixtures.js';
import {result} from '../../../scripts/conformance/diff/result.js';import {normalise,classify} from '../../../scripts/conformance/diff/classify.js';
import {runSourceVM} from '../../../scripts/conformance/diff/engines/source-vm.js';import {runCilVM} from '../../../scripts/conformance/diff/engines/cil-vm.js';import {runRustNative} from '../../../scripts/conformance/diff/engines/rust-native.js';import {runRustWasm} from '../../../scripts/conformance/diff/engines/rust-wasm.js';
import {validateResponse} from '../../../scripts/conformance/diff/engines/rust.js';
import {runChild} from '../../../scripts/conformance/diff/process.js';import {reduceFixture} from '../../../scripts/conformance/diff/reduce.js';import {observeFixture,applyKnown,validateKnown,writeReport} from '../../../scripts/conformance/diff/run.js';
const definition={id:'unit',source:'Program.cs',entry:'Main',stdin:'',capabilities:['console.output'],seed:1729,normalisers:['newlines','float-format','exception-text'],langVersion:'12.0'};
const fixture=source=>hydrateFixture(definition,source),hello=fixture('using System; class Program { static void Main() { Console.WriteLine(42); } }');
const engines=['source-vm','cil-vm','clr-sharpforge','clr-roslyn','rust-native','rust-wasm'];
const records=()=>engines.map(engine=>result(engine,{stdout:'42\n',artifactHash:'a'.repeat(64)}));

test('corpus requires bounded seeds, safe paths and explicit nondeterminism normalisers',async()=>{
 const corpus=await loadCorpus();assert(corpus.length>=8);for(const f of corpus)assert.equal(f.inputHash,fixtureHash(f));
 const withoutSeed={...definition};delete withoutSeed.seed;assert.throws(()=>hydrateFixture(withoutSeed,''),/seed/);
 assert.throws(()=>hydrateFixture({...definition,seed:-1},''));assert.throws(()=>hydrateFixture({...definition,seed:2147483648},''));assert.equal(hydrateFixture({...definition,seed:0},'{{seed}}').sourceText,'0');
 assert.throws(()=>fixture('Environment.TickCount'),/Wall-clock/);assert.throws(()=>fixture('new Dictionary<int,int>()'),/Unordered/);assert.throws(()=>fixture('new Random()'),/Unseeded/);
 assert.doesNotThrow(()=>hydrateFixture({...definition,normalisers:['wall-clock','unordered-lines']},'Environment.TickCount; new Dictionary<int,int>();'));
 assert.throws(()=>hydrateFixture({...definition,source:'../escape.cs'},''));assert.throws(()=>limits({timeoutMs:0}));assert.throws(()=>limits({hidden:1}));assert.throws(()=>fixture('x'.repeat(1024*1024+1)),/1 MiB/);
 const directory=await mkdtemp(path.join(os.tmpdir(),'diff-loader-'));try{await writeFile(path.join(directory,'Program.cs'),'class P {}');await loadFixture(definition,directory);await writeFile(path.join(directory,'corpus.json'),JSON.stringify({schemaVersion:1,fixtures:[definition,definition]}));await assert.rejects(loadCorpus(path.join(directory,'corpus.json')),/Duplicate/);if(process.platform!=='win32'){await symlink(path.join(corpusRoot,'corpus/hello.cs'),path.join(directory,'Escape.cs'));await assert.rejects(loadFixture({...definition,source:'Escape.cs'},directory),/escapes/);}}finally{await rm(directory,{recursive:true,force:true});}
});

test('normalisation preserves numeric meaning and text while canonicalising declared presentation',()=>{
 assert.notEqual(normalise(result('source-vm',{stdout:'9007199254740992'}),hello).stdout,normalise(result('source-vm',{stdout:'9007199254740993'}),hello).stdout);
 assert.equal(normalise(result('source-vm',{stdout:'1.000\r\n-0.0\r\ntext 1.0\r\n'}),hello).stdout,'1\n-0\ntext 1.0\n');
 const a=result('cil-vm',{status:'runtime-error',exitCode:null,exception:{type:'System.Exception',message:'Failure.'}}),b=result('clr-sharpforge',{status:'runtime-error',exitCode:null,exception:{type:'System.Exception',message:'Failure'},stderr:'Unhandled exception. System.Exception: Failure\n   at Program.Main()\n',exceptionDiagnostic:'Unhandled exception. System.Exception: Failure\n   at Program.Main()\n'});assert.deepEqual(normalise(a,hello),normalise(b,hello));
 assert.equal(normalise(result('source-vm',{exitCode:-3}),hello).exitCode,process.platform==='win32'?4294967293:253);
 const tagged={...hello,normalisers:['newlines','wall-clock','unordered-lines']};assert.equal(normalise(result('source-vm',{stdout:'z\nclock=123\na\n'}),tagged).stdout,'a\nclock=<normalised>\nz\n');
 assert.throws(()=>normalise({...a,status:'pass'},hello),/Malformed/);
});

test('classifier distinguishes all four difference classes and refuses unknown provenance',()=>{
 assert.equal(classify(hello,[records(),records()]).differences.length,0);
 for(const [kind,mutate]of [['compiler',r=>r.find(x=>x.engine==='clr-roslyn').stdout='different'],['runtime',r=>r.find(x=>x.engine==='cil-vm').stdout='different'],['host',r=>Object.assign(r[0],{status:'host-error',error:'host service failed'})],['unclassified',r=>Object.assign(r[1],{stdout:'different',artifactHash:'b'.repeat(64)})]]){const r=records();mutate(r);assert(classify(hello,[r,structuredClone(r)]).differences.some(d=>d.class===kind),kind);}
 const second=records();second[0].stdout='unstable';assert(classify(hello,[records(),second]).differences.some(d=>d.class==='fixture-nondeterminism'));
 assert.throws(()=>classify(hello,[records()]),/two/);assert.throws(()=>classify(hello,[records(),records().slice(1)]),/Missing/);
 const missing=records().filter(r=>r.engine!=='clr-roslyn');assert(classify(hello,[missing,missing]).differences.some(d=>d.class==='unclassified'));
});

test('real source and CIL VMs return equal semantic results and bound resource use',async()=>{
 const a=await runSourceVM(hello),b=await runCilVM(hello);assert.equal(a.status,'completed');assert.equal(b.status,'completed');assert.deepEqual(normalise(a,hello),normalise(b,hello));assert.equal(a.stdout,'42\n');
 const active=fixture('class Program { static void Main() { while(true) {} } }');active.limits.maxInstructions=100000000;for(const run of [runSourceVM,runCilVM]){const controller=new AbortController(),pending=run(active,{signal:controller.signal});setTimeout(()=>controller.abort(),20);assert.equal((await pending).status,'cancelled');}

 const loop=fixture('class Program { static void Main() { while(true) {} } }');loop.limits.maxInstructions=100;for(const run of [runSourceVM,runCilVM]){assert.equal((await run(loop)).status,'budget-exceeded');assert.equal((await run(hello,{signal:AbortSignal.abort()})).status,'cancelled');assert.equal((await run({...hello,stdin:'x'})).status,'unsupported');const noisy=fixture('using System; class P { static void Main(){ Console.WriteLine("too much output"); }}');noisy.limits.maxOutputBytes=2;assert.equal((await run(noisy)).status,'budget-exceeded');}
});

test('native process transport passes stdin literally and reaps cancellation, budgets and startup failures',async()=>{
 const input='hello → & $()\n';const run=await runChild(process.execPath,['-e','process.stdin.pipe(process.stdout)'],{stdin:input});assert.equal(run.stdout,input);assert.equal(run.exitCode,0);
 await assert.rejects(runChild(process.execPath,['-e','setTimeout(()=>{},10000)'],{timeoutMs:20}),{code:'budget-exceeded'});
 await assert.rejects(runChild(process.execPath,['-e','console.log("x".repeat(1000))'],{maxOutputBytes:10}),{code:'budget-exceeded'});
 const controller=new AbortController(),pending=runChild(process.execPath,['-e','setTimeout(()=>{},10000)'],{signal:controller.signal});setTimeout(()=>controller.abort(),20);await assert.rejects(pending,{code:'cancelled'});
 await assert.rejects(runChild('sharpforge-deliberately-missing-host',[]),{code:'host-error'});await assert.rejects(runChild(process.execPath,[],{signal:controller.signal}),{code:'cancelled'});assert.throws(()=>runChild(process.execPath,[],{timeoutMs:0}),RangeError);
});

test('A27 absent artifacts remain unsupported and cannot become a pass',async()=>{
 const response={protocol:'sharpforge-differential-v1',engine:'rust-native',inputHash:hello.inputHash,status:'completed',stdout:'42\n',stderr:'',exitCode:0,exception:null};assert.equal(validateResponse(response,'rust-native',hello.inputHash),response);for(const bad of [{...response,inputHash:'wrong'},{...response,extra:true},{...response,status:'runtime-error',exitCode:null},{...response,exitCode:2147483648}])assert.throws(()=>validateResponse(bad,'rust-native',hello.inputHash));
 assert.equal((await runRustNative(hello,{artifact:'/deliberately-absent-a27-host'})).status,'unsupported');assert.equal((await runRustWasm(hello,{artifact:'/deliberately-absent-a27.wasm',wasmHost:'/deliberately-absent-host'})).status,'unsupported');
});

test('known differences require exact fingerprints and unclassified failures cannot be suppressed',()=>{
 const r=records();r[1].stdout='changed';const differences=classify(hello,[r,r]).differences,rows=[{id:hello.id,differences}],known={schemaVersion:1,differences:differences.map(d=>({fingerprint:d.fingerprint,class:d.class,fixtureId:hello.id,reason:'Reviewed unit fixture'}))};assert.equal(applyKnown(rows,known).newDifferences.length,0);const subset=applyKnown([{id:'unrelated',differences:[]}],known);assert.equal(subset.resolvedKnown.length,0);assert.equal(subset.unexaminedKnown.length,1);assert.equal(applyKnown(rows,{schemaVersion:1,differences:[]}).newDifferences.length,1);assert.throws(()=>validateKnown({...known,differences:[...known.differences,...known.differences]}),/duplicate/);assert.throws(()=>validateKnown({schemaVersion:1,differences:[{...known.differences[0],class:'unclassified'}]}),/Invalid/);
});

test('seeded reducer removes statements and members reproducibly with strict class and budget retention',async()=>{
 const source=['using System;','class Program {',...Array.from({length:20},(_,i)=>`static int Unused${i}() { return ${i}; }`),'static void Main() {',...Array.from({length:200},(_,i)=>`int unused${i} = ${i};`),'Console.WriteLine("REPRO");','}','}'].join('\n'),f=fixture(source),difference={class:'runtime',engines:['clr-sharpforge','cil-vm'],statuses:['completed','completed'],phase:'execute'};
 // This predicate tests reducer mechanics only; real native reduction is separately mandatory.
 const observe=async candidate=>({differences:candidate.sourceText.includes('Console.WriteLine("REPRO")')?[difference]:[]});
 const a=await reduceFixture(f,difference,observe),b=await reduceFixture(f,difference,observe);assert.deepEqual(a,b);assert(a.afterLines<20);assert(a.beforeLines>200);assert(a.source.includes('REPRO'));assert.equal(a.budgetExhausted,false);
 const limited=await reduceFixture(f,difference,observe,{maxAttempts:1});assert(limited.budgetExhausted);await assert.rejects(reduceFixture(f,difference,observe,{signal:AbortSignal.abort()}),/cancelled/);await assert.rejects(reduceFixture(f,difference,async()=>({differences:[]})),/does not reproduce/);await assert.rejects(reduceFixture(f,{...difference,class:'host'},observe),/Only deterministic/);
});

test('adapter exceptions and cancellation are visible; report includes distinct unsupported rows',async()=>{
 const adapters=Object.fromEntries(engines.map(engine=>[engine,async()=>result(engine)]));adapters['source-vm']=async()=>{throw Error('host unavailable');};const observed=await observeFixture(hello,{adapters});assert(observed.differences.some(d=>d.class==='host'));const cancelled=await observeFixture(hello,{adapters,signal:AbortSignal.abort()});assert(cancelled.observations.flat().every(r=>r.status==='cancelled'));
 const directory=await mkdtemp(path.join(os.tmpdir(),'diff-report-'));try{const report={differences:[],fixtures:[{id:'unit',unsupported:[{engine:'rust-native',reason:'A27 absent'}]}]};await writeReport(report,directory);assert.match(await readFile(path.join(directory,'report.md'),'utf8'),/unsupported.*rust-native/);const first=await readFile(path.join(directory,'report.json'));await writeReport(report,directory);assert.deepEqual(await readFile(path.join(directory,'report.json')),first);}finally{await rm(directory,{recursive:true,force:true});}
});
