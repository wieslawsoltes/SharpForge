import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {benchmark,report,distribution,validateReport,sha,pinCheckouts} from '../../../scripts/conformance/perf/core.js';
import {normalize,producers} from '../../../scripts/conformance/perf/normalize.js';
import {compare,signProbability,summary} from '../../../scripts/conformance/perf/compare.js';
import {execute} from '../../../scripts/conformance/perf/process.js';
import {beginAllocation,finishAllocation,allocationSummary} from '../../../scripts/conformance/perf/alloc.js';
import {ab} from '../../../scripts/conformance/perf/ab.js';
import {checkSizes,size} from '../../../scripts/conformance/perf/size-budget.js';
import {updateBaseline,readBaseline} from '../../../scripts/conformance/perf/update-baseline.js';
import {normalizeBrowser,verifyTraces} from '../../../scripts/conformance/perf/normalize-browser.js';
const env={node:process.version,platform:process.platform,arch:process.arch,cpu:'test-cpu',logicalCpus:1,osRelease:'test',runnerName:'isolated-control-fixture',commit:'a'.repeat(40)};
const row=values=>benchmark({id:'A05/control',area:'A05',engine:'fixture-statistics-only',samples:values,coldSamples:[12],checksum:'42'});
const record=values=>report([row(values)],env);
test('one schema retains raw samples from all five legacy output shapes',()=>{
 for(const producer of producers){
  const raw={correctness:{passed:true},results:[{name:'producer shape fixture',rawSamples:[3,1,2],coldSamples:[5],checksum:42}]};
  if(producer==='benchmark-il.js'){raw.pipeline=[{approximateLines:1000,...Object.fromEntries(['compile','emit','decode','verification','loadTotal','oneFileEditAnalysis'].map(k=>[k,{rawSamples:[3,1,2]}]))}];raw.execution=[{name:'loop',rawPairs:[{irMs:1,ilMs:2},{irMs:2,ilMs:3}],exitCode:42,instructions:100,heapAllocations:2}];}
  const normalized=normalize(producer,raw,env);assert(validateReport(normalized));assert(normalized.benchmarks.length);assert.deepEqual(normalized.benchmarks[0].samples,[3,1,2]);
 }
 assert.throws(()=>normalize('benchmark.js',{correctness:{passed:true},results:[{name:'discarded',medianMs:1}]},env),/samples/);
 assert.throws(()=>normalize('benchmark.js',{results:[]},env),/correctness/);
});
test('raw measurements reject nonfinite values and summary tampering; tails include every sample',()=>{
 assert.deepEqual(distribution([1,2,3,100]),{count:4,median:2.5,p95:100,p99:100,min:1,max:100});
 for(const values of [[],[-1],[NaN],[Infinity],['1']])assert.throws(()=>row(values));
 const value=record([1,2,3]);value.benchmarks[0].statistics.median=0;assert.throws(()=>validateReport(value),/Statistics/);
 const unsupported=record([1]);unsupported.unsupported=[{target:'native'}];assert.throws(()=>validateReport(unsupported));
});
test('paired controls detect injected 15% slowdown and pass 20 independent A/A trials',()=>{
 for(let trial=0;trial<20;trial++){
  const base=Array.from({length:40},(_,i)=>10+((i*17+trial*11)%23)/20),aa=base.map((v,i)=>v*(i%2?.997:1.003));
  assert.equal(compare(record(base),record(aa)).passed,true,'A/A statistical control '+trial);
  const result=compare(record(base),record(base.map(v=>v*1.15)));assert.equal(result.passed,false);assert.equal(result.rows[0].verdict,'regression');assert(result.rows[0].pValue<.01);assert.match(summary(result),/15.0%.*regression/);
 }
 assert.equal(signProbability(20,20),2**-20);
 assert(Math.abs(signProbability(600,1200)-.5115140726343013)<1e-10);
 assert(signProbability(60000,100000)<.01);
 assert(signProbability(50000,100000)>.5);
 assert.throws(()=>signProbability(2,1),/Invalid/);
});
test('comparison rejects mismatches; explicit quarantine retains the regression verdict and expiry',()=>{
 const a=record(Array(20).fill(10)),b=record(Array(20).fill(12));
 b.runnerId='different';assert.throws(()=>compare(a,b),/same runner/);b.runnerId=a.runnerId;
 b.benchmarks[0].correctness.checksum='wrong';assert.throws(()=>compare(a,b),/Correctness/);b.benchmarks[0].correctness.checksum='42';
 const quarantine=[{id:'A05/control',reason:'tracked noisy runner #123',expires:'2099-01-01'}];assert.equal(compare(a,b,{quarantine}).rows[0].verdict,'quarantined');
 assert.throws(()=>compare(a,b,{quarantine:[{...quarantine[0],expires:'2000-01-01'}]}),/expired/);
 assert.throws(()=>compare(a,b,{quarantine:[{...quarantine[0],expires:'not-a-date'}]}),/expired/);
 assert.throws(()=>compare(record([1]),record([2])),/Insufficient/);
 assert.equal(compare(record(Array(20).fill(0)),record(Array(20).fill(1))).passed,false);
});
test('subprocess timeout, cancellation and output bounds terminate execution',async()=>{
 await assert.rejects(execute(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:40}),{code:'TIMEOUT'});
 const controller=new AbortController(),pending=execute(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal});setTimeout(()=>controller.abort(),40);await assert.rejects(pending,{code:'ABORT_ERR'});
 const aborted=new AbortController();aborted.abort();assert.throws(()=>execute(process.execPath,[],{signal:aborted.signal}));
 await assert.rejects(execute(process.execPath,['-e','process.stdout.write("x".repeat(10000))'],{maxOutputBytes:10}),/output limit/);
 const literal=await execute(process.execPath,['-e','console.log(process.argv[1])','a b;$HOME']);assert.equal(literal.stdout.trim(),'a b;$HOME');
});
test('managed metrics use allocation and pause counters, independently from Node deltas',()=>{
 const vm={heap:{stats:{allocations:10,allocatedBytes:100,collections:2,totalPauseMs:3,maxPauseMs:2}}},before=beginAllocation(vm);
 Object.assign(vm.heap.stats,{allocations:16,allocatedBytes:160,collections:3,totalPauseMs:4,maxPauseMs:2});
 const result=finishAllocation(before,vm,3);assert.equal(result.managed.allocationsPerOperation,2);assert.equal(result.managed.collections,1);assert.equal(result.nativeAllocations.status,'unsupported');
 assert.equal(allocationSummary([result,result]).stable,true);assert.equal(allocationSummary([result,{...result,managed:{...result.managed,allocationsPerOperation:4}}]).stable,false);
 assert.throws(()=>finishAllocation(before,vm,0));
});
test('size budgets name exact excess and reject missing or unreviewed artifacts',async()=>{
 const policy={schemaVersion:1,budgets:[{id:'worker:x',maxBytes:100}]};assert.equal(checkSizes([{id:'worker:x',bytes:100}],policy).passed,true);
 const failed=checkSizes([{id:'worker:x',bytes:101}],policy);assert.equal(failed.passed,false);assert.equal(failed.artifacts[0].delta,1);
 assert.throws(()=>checkSizes([],policy),/missing/);assert.throws(()=>checkSizes([{id:'worker:y',bytes:1}],policy),/Missing reviewed/);
 const dir=mkdtempSync(join(tmpdir(),'perf-size-'));try{mkdirSync(join(dir,'nested'));writeFileSync(join(dir,'a'),'12');writeFileSync(join(dir,'nested','b'),'345');assert.equal(await size(dir),5);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('baseline writer requires samples and environment; reader ignores dirty files and rejects corrupted digests',()=>{
 const dir=mkdtempSync(join(tmpdir(),'perf-baseline-')),g=(...a)=>execFileSync('git',a,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  g('init');g('config','user.email','test@example.invalid');g('config','user.name','test');writeFileSync(join(dir,'seed'),'fixture');g('add','.');g('commit','-m','seed');
  const current={...env,commit:g('rev-parse','HEAD')},raw=report([row(Array(20).fill(1))],current),rawPath=join(dir,'raw.json'),environmentPath=join(dir,'env.json');
  writeFileSync(rawPath,JSON.stringify(raw));writeFileSync(environmentPath,JSON.stringify(current));assert.throws(()=>updateBaseline({root:dir,id:'fixture'}),/Raw samples/);
  const config={root:dir,rawPath,environmentPath,id:'fixture',reviewUrl:'https://github.com/example/repo/pull/1',reviewer:'reviewer',reason:'statistical fixture only'},stored=updateBaseline(config);g('add','.');g('commit','-m','reviewed fixture');
  const path=join(dir,'planning/qualification/perf-baselines/fixture/baseline.json');writeFileSync(path,'malformed');assert.equal(readBaseline(dir,'fixture').commit,stored.commit);
  writeFileSync(path,JSON.stringify({...stored,rawDigest:'0'.repeat(64)}));g('add','.');g('commit','-m','corrupt');assert.throws(()=>readBaseline(dir,'fixture'),/digest/);
  raw.benchmarks[0].samples=[];writeFileSync(rawPath,JSON.stringify(raw));assert.throws(()=>updateBaseline(config));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('browser normalizer requires independent actual-engine evidence and retained traces',()=>{
 const raw={schemaVersion:1,commit:env.commit,engine:'chromium',browser:'fixture-version',correctness:true,traces:Array.from({length:3},(_,i)=>({path:i+'.zip',sha256:sha(String(i))})),samples:Object.fromEntries(['startup','firstCompile','typing','toolActivation'].map(k=>[k,[1,2,3]])),measurement:{}};
 assert.equal(normalizeBrowser(raw,env).benchmarks.length,4);assert.throws(()=>normalizeBrowser({...raw,correctness:false},env));assert.throws(()=>normalizeBrowser({...raw,commit:'b'.repeat(40)},env));assert.throws(()=>normalizeBrowser({...raw,traces:[]},env));
});

test('A/B executes both real Git revisions independently and disposes its worktrees on success and cancellation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'perf-paired-')),root=join(dir,'repo');mkdirSync(root);
 const g=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  g('init');g('config','user.email','test@example.invalid');g('config','user.name','test');
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'paired-service-fixture',version:'1.0.0',private:true}));
  writeFileSync(join(root,'package-lock.json'),JSON.stringify({name:'paired-service-fixture',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'paired-service-fixture',version:'1.0.0'}}}));
  writeFileSync(join(root,'.gitignore'),'node_modules/\n');writeFileSync(join(root,'value.json'),'42');g('add','.');g('commit','-m','base');const base=g('rev-parse','HEAD');
  writeFileSync(join(root,'head-marker'),'separate actual revision');g('add','.');g('commit','-m','head');const head=g('rev-parse','HEAD');
  const registry=join(dir,'registry.json');writeFileSync(registry,JSON.stringify(['A29/process-fixture','A29/process/fixture','A29/process_fixture'].map(id=>({id,area:'A29',engine:'node-service-integration-fixture',module:'fixture.mjs'}))));
  writeFileSync(join(dir,'fixture.mjs'),"import {readFileSync} from 'node:fs';import {join} from 'node:path';import assert from 'node:assert/strict';export async function create({root}){const value=JSON.parse(readFileSync(join(root,'value.json'),'utf8'));assert.equal(value,42);return async()=>{const start=performance.now();await new Promise(r=>setTimeout(r,3));return {ms:performance.now()-start,checksum:String(value)};};}");
  const result=await ab({root,base,head,registry,ids:['A29/process/fixture','A29/process_fixture'],pairs:3,warmups:0,threshold:1,output:join(dir,'result')});
  assert.equal(result.baseCommit,base);assert.equal(result.headCommit,head);assert.equal(result.passed,true);
  const order=JSON.parse(readFileSync(join(dir,'result/run.json'),'utf8')).order;assert.equal(new Set(order.map(r=>r.artifact)).size,12);
  for(const entry of order)assert.equal(JSON.parse(readFileSync(join(dir,'result',entry.artifact),'utf8')).benchmarks[0].id,entry.id);
  assert.equal(g('worktree','list','--porcelain').split('worktree ').length-1,1);
  assert.equal(g('status','--porcelain'),'');
  const controller=new AbortController(),pending=ab({root,base,head,registry,ids:['A29/process-fixture'],pairs:20,warmups:0,output:join(dir,'cancel'),signal:controller.signal});
  setTimeout(()=>controller.abort(),150);await assert.rejects(pending);
  assert.equal(g('worktree','list','--porcelain').split('worktree ').length-1,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('cancelling a parent also reaps children which ignore SIGTERM',{skip:process.platform==='win32'?'POSIX process-group semantics; Windows uses taskkill /T':false},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'perf-descendant-')),file=join(dir,'pid');let child;
 try{
  const script="const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','process.on(\"SIGTERM\",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000)";
  await assert.rejects(execute(process.execPath,['-e',script,file],{timeoutMs:400}),{code:'TIMEOUT'});child=Number(readFileSync(file,'utf8'));
  await new Promise(r=>setTimeout(r,100));assert.throws(()=>process.kill(child,0),{code:'ESRCH'});
 }finally{if(child)try{process.kill(child,'SIGKILL');}catch{}rmSync(dir,{recursive:true,force:true});}
});
test('browser evidence verifies actual retained trace bytes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'perf-trace-'));try{writeFileSync(join(dir,'chromium-0.zip'),'trace-byte-fixture');const raw={traces:[{path:'chromium-0.zip',sha256:sha('trace-byte-fixture')}]};assert.doesNotThrow(()=>verifyTraces(raw,dir));writeFileSync(join(dir,'chromium-0.zip'),'changed');assert.throws(()=>verifyTraces(raw,dir),/digest/);assert.throws(()=>verifyTraces({traces:[{path:'../escape',sha256:'a'.repeat(64)}]},dir),/digest/);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('capture pins both clean product and harness revisions',()=>{
 const dir=mkdtempSync(join(tmpdir(),'perf-provenance-'));
 const init=name=>{const root=join(dir,name);mkdirSync(root);const g=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();g('init');g('config','user.email','test@example.invalid');g('config','user.name','test');writeFileSync(join(root,'code'),'initial');g('add','.');g('commit','-m','initial');return {root,g};};
 try{
  const product=init('product'),harness=init('harness'),captured=pinCheckouts(product.root,harness.root);assert.doesNotThrow(()=>captured.verify());
  writeFileSync(join(harness.root,'code'),'dirty');assert.throws(()=>pinCheckouts(product.root,harness.root),/clean/);assert.throws(()=>captured.verify(),/clean/);
  harness.g('add','.');harness.g('commit','-m','changed harness');assert.throws(()=>captured.verify(),/changed/);
  const next=pinCheckouts(product.root,harness.root);product.g('commit','--allow-empty','-m','changed target');assert.throws(()=>next.verify(),/changed/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
