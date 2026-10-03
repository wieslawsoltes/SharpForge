import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {benchmark,report,distribution,validateReport,sha} from '../../../scripts/conformance/perf/core.js';
import {normalize,producers} from '../../../scripts/conformance/perf/normalize.js';
import {compare,signProbability,summary} from '../../../scripts/conformance/perf/compare.js';
import {execute} from '../../../scripts/conformance/perf/process.js';
import {beginAllocation,finishAllocation,allocationSummary} from '../../../scripts/conformance/perf/alloc.js';
import {checkSizes,size} from '../../../scripts/conformance/perf/size-budget.js';
import {updateBaseline,readBaseline} from '../../../scripts/conformance/perf/update-baseline.js';
import {normalizeBrowser} from '../../../scripts/conformance/perf/normalize-browser.js';
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
});
test('comparison rejects mismatches; explicit quarantine retains the regression verdict and expiry',()=>{
 const a=record(Array(20).fill(10)),b=record(Array(20).fill(12));
 b.runnerId='different';assert.throws(()=>compare(a,b),/same runner/);b.runnerId=a.runnerId;
 b.benchmarks[0].correctness.checksum='wrong';assert.throws(()=>compare(a,b),/Correctness/);b.benchmarks[0].correctness.checksum='42';
 const quarantine=[{id:'A05/control',reason:'tracked noisy runner #123',expires:'2099-01-01'}];assert.equal(compare(a,b,{quarantine}).rows[0].verdict,'quarantined');
 assert.throws(()=>compare(a,b,{quarantine:[{...quarantine[0],expires:'2000-01-01'}]}),/expired/);
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
