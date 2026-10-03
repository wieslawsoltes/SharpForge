import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execute} from './process.js';
import {normalize,producers} from './normalize.js';
import {args,isMain,repository,environment,clean,writeJson,json} from './core.js';
export async function legacy({root=repository,output=join(root,'artifacts/results/performance/legacy'),signal}={}){
 const head=clean(root),env=environment(root),results=[];await mkdir(output,{recursive:true});
 for(const producer of producers){
  const rawPath=join(output,producer+'.raw.json'),result=await execute(process.execPath,[join(root,'scripts',producer)],{cwd:root,env:{...process.env,BENCH_REPORT:rawPath},timeoutMs:600000,signal});
  await writeFile(join(output,producer+'.stdout.txt'),result.stdout);await writeFile(join(output,producer+'.stderr.txt'),result.stderr);
  const raw=['benchmark-release14.js','benchmark-compute14.js'].includes(producer)?JSON.parse(result.stdout):json(rawPath);
  if(['benchmark-release14.js','benchmark-compute14.js'].includes(producer))writeJson(rawPath,raw);
  const normalized=normalize(producer,raw,env);writeJson(join(output,producer+'.normalized.json'),normalized);results.push({producer,benchmarks:normalized.benchmarks.length,raw:rawPath});
 }
 if(clean(root)!==head)throw new Error('Producer changed checkout');writeJson(join(output,'index.json'),{commit:head,results});return results;
}
if(isMain(import.meta.url)){const a=args();console.log(JSON.stringify(await legacy({root:resolve(a.root??repository),output:a.output}),null,2));}
