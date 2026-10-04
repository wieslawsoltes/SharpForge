import {pinRegistry} from './registry.js';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {npmCli} from '../node-tools.js';
import {execute} from './process.js';
import {adapters} from './workloads.js';
import {readBaseline} from './update-baseline.js';
import {committedJson} from './size-budget.js';
import {compare,summary} from './compare.js';
import {combineMeasurements} from './combine.js';
import {args,integer,isMain,repository,git,clean,report,writeJson,json,pinCheckouts} from './core.js';
export async function ab({root=repository,base,head='HEAD',ids,registry=null,pairs=20,warmups=3,output=join(root,'artifacts/results/performance/ab'),signal,timeoutMs=120000,threshold=.05,quarantine=[]}={}){
 if(!base)throw new Error('An explicit baseline commit is required');
 const capturedHarness=pinCheckouts(root);
 integer(pairs,20,3,200);integer(warmups,3,0,100);
 const pinnedRegistry=pinRegistry(registry),registered=[...adapters,...pinnedRegistry.rows];if(new Set(registered.map(a=>a.id)).size!==registered.length)throw new Error('Duplicate adapter registration');ids??=registered.map(a=>a.id);
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!registered.some(a=>a.id===id)))throw new Error('Unknown/duplicate adapter');
 const commits={base:git(root,'rev-parse','--verify',base+'^{commit}'),head:git(root,'rev-parse','--verify',head+'^{commit}')};
 const directory=await mkdtemp(join(tmpdir(),'sharpforge-perf-')),trees={},captured={base:[],head:[]},order=[];
 output=resolve(output);await mkdir(output,{recursive:true});
 const run=(cmd,argv,cwd)=>execute(cmd,argv,{cwd,signal,timeoutMs});
 let completed=false;
 try{
  for(const side of ['base','head']){
   signal?.throwIfAborted();trees[side]=join(directory,side);
   await run('git',['worktree','add','--detach',trees[side],commits[side]],root);
   const npm=npmCli();if(!npm)throw new Error('npm CLI unavailable');await run(process.execPath,[npm,'ci','--ignore-scripts','--no-audit','--no-fund'],trees[side]);clean(trees[side]);
  }
  for(const id of ids)for(let pair=0;pair<pairs;pair++)for(const side of pair%2?['head','base']:['base','head']){
   const argv=[fileURLToPath(new URL('./measure.js',import.meta.url)),'--root',trees[side],'--adapter',id,'--samples','1','--warmups',String(warmups),...(registry?['--registry',resolve(registry)]:[])],started=new Date().toISOString();
   const result=await run(process.execPath,argv,trees[side]);
   const raw=JSON.parse(result.stdout),name=side+'-'+ids.indexOf(id)+'-'+id.replaceAll('/','_').slice(0,80)+'-'+pair;
   if(raw.commit!==commits[side])throw new Error('Measured commit changed');
   if(JSON.stringify(raw.registry??null)!==JSON.stringify(pinnedRegistry.identity))throw new Error('Measured registry changed');
   writeJson(join(output,name+'.json'),raw);await writeFile(join(output,name+'.stderr.txt'),result.stderr);
   captured[side].push(raw);order.push({side,id,pair,started,command:[process.execPath,...argv],artifact:name+'.json'});
  }
  for(const side of ['base','head'])if(clean(trees[side])!==commits[side])throw new Error('Checkout changed during benchmark');
  const combine=side=>report(ids.map(id=>combineMeasurements(captured[side].flatMap(x=>x.benchmarks).filter(x=>x.id===id))),captured[side][0].environment,{registry:pinnedRegistry.identity});
  capturedHarness.verify();pinnedRegistry.verify();
  const before=combine('base'),after=combine('head'),result=compare(before,after,{threshold,minSamples:pairs,quarantine});
  writeJson(join(output,'base.json'),before);writeJson(join(output,'head.json'),after);writeJson(join(output,'comparison.json'),result);await writeFile(join(output,'summary.md'),summary(result));completed=true;return result;
 }finally{
  writeJson(join(output,'run.json'),{schemaVersion:1,commits,order,completed});
  for(const tree of Object.values(trees)){try{await execute('git',['worktree','remove','--force',tree],{cwd:root,timeoutMs:30000});}catch{}}
  await rm(directory,{recursive:true,force:true});
 }
}
if(isMain(import.meta.url)){const a=args(),controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());const result=await ab({root:resolve(a.root??repository),base:a.base??(a.baseline?readBaseline(resolve(a.root??repository),a.baseline,a['policy-ref']??'HEAD').commit:undefined),registry:a.registry,head:a.head??'HEAD',ids:a.adapters?.split(','),pairs:integer(a.pairs,20,3,200),warmups:integer(a.warmups,3,0,100),output:a.output,timeoutMs:integer(a.timeout,120000,1,3600000),threshold:a.threshold===undefined?.05:Number(a.threshold),signal:controller.signal,quarantine:a['policy-ref']?committedJson(resolve(a.root??repository),a['policy-ref'],'planning/qualification/perf-baselines/quarantine.json').benchmarks:[]});process.stdout.write(summary(result));if(!result.passed)process.exitCode=1;}
