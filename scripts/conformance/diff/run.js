import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';import {parseArgs} from 'node:util';
import {performance} from 'node:perf_hooks';
import {loadCorpus,fixtureHash,root,corpusRoot} from './fixtures.js';
import {resolveToolchain,pin} from '../oracle/toolchain.js';
import {runSourceVM} from './engines/source-vm.js';import {runCilVM} from './engines/cil-vm.js';import {runSharpCLR,runRoslynCLR} from './engines/clr.js';import {runRustNative} from './engines/rust-native.js';import {runRustWasm} from './engines/rust-wasm.js';import {compileSharp} from './engines/vm.js';
import {failure} from './result.js';import {classify} from './classify.js';import {reduceFixture} from './reduce.js';
export const engineAdapters=Object.freeze({'source-vm':runSourceVM,'cil-vm':runCilVM,'clr-sharpforge':runSharpCLR,'clr-roslyn':runRoslynCLR,'rust-native':runRustNative,'rust-wasm':runRustWasm});
export async function observeFixture(fixture,{repetitions=2,signal,toolchain,adapters=engineAdapters}={}){
  if(fixture.inputHash!==fixtureHash(fixture))throw new Error('Stale fixture identity; source and execution policy must be rehashed');
  if(!Number.isSafeInteger(repetitions)||repetitions<2||repetitions>100)throw new RangeError('Repetitions must be between 2 and 100');
  const observations=[];
  for(let repeat=0;repeat<repetitions;repeat++){
    const compileStarted=performance.now(),compiled=adapters===engineAdapters&&!signal?.aborted?compileSharp(fixture):undefined,sharedCompileMs=performance.now()-compileStarted,records=[];
    for(const [engine,adapter]of Object.entries(adapters)){if(signal?.aborted){records.push(failure(engine,{code:'cancelled',message:'Run cancelled'}));continue;}try{records.push(await adapter(fixture,{signal,toolchain,sharedCompileMs,...(engine!=='source-vm'?{compiled}:{})}));}catch(error){records.push(failure(engine,error));}}
    observations.push(records);
  }
  return {...classify(fixture,observations),observations};
}
export function validateKnown(value){
  if(value.schemaVersion!==1||!Array.isArray(value.differences)||Object.keys(value).some(k=>!['schemaVersion','differences'].includes(k)))throw new Error('Malformed known-differences file');
  const seen=new Set();for(const row of value.differences){if(!/^[a-f0-9]{64}$/.test(row.fingerprint)||!['compiler','runtime','host','fixture-nondeterminism'].includes(row.class)||typeof row.fixtureId!=='string'||!row.fixtureId||typeof row.reason!=='string'||!row.reason||seen.has(row.fingerprint)||Object.keys(row).some(k=>!['fingerprint','fixtureId','class','reason','trackingIssue'].includes(k)))throw new Error('Invalid or duplicate known difference');seen.add(row.fingerprint);}return value;
}
export function applyKnown(fixtures,known){validateKnown(known);const observed=new Set(),differences=fixtures.flatMap(f=>f.differences.map(d=>({...d,fixtureId:f.id})));for(const difference of differences){const entry=known.differences.find(row=>row.fingerprint===difference.fingerprint&&row.class===difference.class&&row.fixtureId===difference.fixtureId);difference.known=!!entry&&difference.class!=='unclassified';if(difference.known)observed.add(entry.fingerprint);}return {differences,newDifferences:differences.filter(d=>!d.known),resolvedKnown:known.differences.filter(d=>!observed.has(d.fingerprint))};}
export async function writeReport(report,directory){
  await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
  const lines=['# Differential observations','','Native execution is recorded separately from unsupported A27 adapters.','','| Fixture | Class | Engines | Known | Repro |','| --- | --- | --- | --- | --- |'];for(const d of report.differences)lines.push(`| ${d.fixtureId} | ${d.class} | ${d.engines.join(' / ')} | ${d.known} | ${d.reproPath??'not generated'} |`);for(const f of report.fixtures)for(const u of f.unsupported)lines.push(`| ${f.id} | unsupported | ${u.engine} | — | ${u.reason} |`);await writeFile(path.join(directory,'report.md'),lines.join('\n')+'\n');
}
export async function runCorpus({fixtures,output=path.join(root,'artifacts/differential'),knownFile=path.join(corpusRoot,'known-differences.json'),toolchain,repetitions=2,signal,reduce=true}={}){
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim(),commit=git(['rev-parse','HEAD']),dirtyBefore=git(['status','--porcelain','--untracked-files=all']);
  fixtures??=await loadCorpus();toolchain??=await resolveToolchain();const known=validateKnown(JSON.parse(await readFile(knownFile,'utf8'))),reports=[],start=performance.now(),heapBefore=process.memoryUsage().heapUsed;
  for(const fixture of fixtures){const observed=await observeFixture(fixture,{toolchain,repetitions,signal});const item={id:fixture.id,inputHash:fixture.inputHash,seed:fixture.seed,capabilities:fixture.capabilities,...observed};reports.push(item);
    for(const difference of item.differences){const directory=path.join(output,'repros',fixture.id,difference.fingerprint);await mkdir(directory,{recursive:true});let source=fixture.sourceText,reduction=null;
      if(reduce&&!signal?.aborted&&['compiler','runtime'].includes(difference.class)){try{reduction=await reduceFixture(fixture,difference,(candidate,options)=>observeFixture(candidate,{toolchain,...options}),{signal});source=reduction.source;}catch(error){reduction={error:error.message};}}
      await writeFile(path.join(directory,'repro.cs'),source);const definition=Object.fromEntries(['id','entry','stdin','capabilities','seed','normalisers','langVersion','limits'].map(key=>[key,fixture[key]]));await writeFile(path.join(directory,'fixture.json'),JSON.stringify({...definition,source:'repro.cs'},null,2)+'\n');await writeFile(path.join(directory,'reduction.json'),JSON.stringify(reduction,null,2)+'\n');difference.reproPath=path.relative(output,path.join(directory,'repro.cs')).split(path.sep).join('/');
    }
  }
  const policy=applyKnown(reports,known),dirtyAfter=git(['status','--porcelain','--untracked-files=all']),stableCommit=commit===git(['rev-parse','HEAD']),report={schemaVersion:1,commit,qualification:!dirtyBefore&&!dirtyAfter&&stableCommit?'committed-local-observation':'development-uncommitted-observation',stableCommit,node:process.version,platform:process.platform+'-'+process.arch,toolchain:toolchain.actual,environment:toolchain.environment,pins:{sdk:pin.sdk,runtime:pin.runtime},repetitions,fixtures:reports,...policy,elapsedMs:performance.now()-start,heapUsedDeltaBytes:process.memoryUsage().heapUsed-heapBefore,allocationScope:'VM managed heap counters only. Node heap delta is not exact allocation accounting; native process allocations are unavailable.',parityPassed:policy.differences.length===0&&reports.every(f=>f.observations[0].filter(r=>['source-vm','cil-vm','clr-sharpforge','clr-roslyn'].includes(r.engine)).every(r=>!['unsupported','host-error','cancelled','budget-exceeded'].includes(r.status))),passed:policy.newDifferences.length===0&&!signal?.aborted&&stableCommit};await writeReport(report,output);return report;
}
export async function main(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,options:{corpus:{type:'string',default:path.join(corpusRoot,'corpus.json')},output:{type:'string',default:path.join(root,'artifacts/differential')},known:{type:'string',default:path.join(corpusRoot,'known-differences.json')},fixture:{type:'string'},repetitions:{type:'string',default:'2'},'no-reduce':{type:'boolean',default:false}}});
  let fixtures=await loadCorpus(values.corpus);if(values.fixture){fixtures=fixtures.filter(f=>f.id===values.fixture);if(!fixtures.length)throw new Error('Unknown fixture '+values.fixture);}
  const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{const report=await runCorpus({fixtures,output:values.output,knownFile:values.known,repetitions:Number(values.repetitions),reduce:!values['no-reduce'],signal:controller.signal});console.log(JSON.stringify({passed:report.passed,fixtures:report.fixtures.length,differences:report.differences.length,newDifferences:report.newDifferences.length,unsupported:report.fixtures.reduce((n,f)=>n+f.unsupported.length,0),output:values.output},null,2));if(!report.passed)process.exitCode=1;return report;}finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(async error=>{const directory=path.join(root,'artifacts/differential');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'fatal.json'),JSON.stringify({status:'host-error',message:error.message},null,2)+'\n');console.error(error);process.exitCode=1;});
