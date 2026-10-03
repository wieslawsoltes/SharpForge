import {pinRegistry} from './registry.js';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {allocationSummary} from './alloc.js';
import {adapters,workload} from './workloads.js';
import {args,integer,isMain,repository,environment,report,benchmark,writeJson,json,pinCheckouts} from './core.js';
export async function measure({root=repository,id,iterations=20,warmups=3,registry=null}={}){
 integer(iterations,20,1,10000);integer(warmups,3,0,1000);
 const registered=pinRegistry(registry),extra=registered.rows;
 if(!Array.isArray(extra))throw new Error('Registry must be an array');
 const all=[...adapters,...extra],ids=new Set();
 for(const row of all){if(ids.has(row.id))throw new Error('Duplicate adapter '+row.id);ids.add(row.id);}
 const selected=id?all.filter(a=>a.id===id):all;if(!selected.length)throw new Error('Unknown adapter '+id);
 const captured=pinCheckouts(root),env=environment(root),rows=[];
 for(const adapter of selected){
  const create=adapter.module?(await import(pathToFileURL(resolve(registry,'..',adapter.module)))).create:workload;
  const run=adapter.module?await create({root,adapter}):await create(root,adapter),cold=await run(),values=[],metrics=[];
  if(!cold||typeof cold.checksum!=='string')throw new Error('Adapter must return verified checksum');
  for(let i=0;i<warmups;i++){const r=await run();if(r.checksum!==cold.checksum)throw new Error('Warmup correctness mismatch');}
  for(let i=0;i<iterations;i++){const r=await run();if(r.checksum!==cold.checksum)throw new Error('Sample correctness mismatch');values.push(r.ms);metrics.push(r.metrics??null);}
  rows.push(benchmark({...adapter,samples:values,coldSamples:[cold.ms],checksum:cold.checksum,metrics:{samples:metrics,allocationSummary:allocationSummary(metrics)}}));
 }
 captured.verify();registered.verify();
 return report(rows,env,{harnessCommit:captured.harnessCommit,registry:registered.identity,unsupported:[{target:'native-rust/clr/wasm-runtime',reason:'These adapters execute JS VMs and compute SIMD only; no native runtime performance claim'}]});
}
if(isMain(import.meta.url)){const a=args();const result=await measure({root:resolve(a.root??repository),id:a.adapter,iterations:integer(a.samples,20,1,10000),warmups:integer(a.warmups,3,0,1000),registry:a.registry});if(a.output)writeJson(a.output,result);else console.log(JSON.stringify(result));}
