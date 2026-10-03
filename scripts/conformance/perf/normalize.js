import {args,isMain,json,environment,report,benchmark,writeJson,repository,sha} from './core.js';
export const producers=['benchmark.js','benchmark-il.js','benchmark-release06.js','benchmark-release14.js','benchmark-compute14.js'];
/** Raw values must come from the producer. Summary-only historical outputs fail closed. */
export function normalize(producer,input,env=environment()){
 if(!producers.includes(producer))throw new Error('Unknown benchmark producer '+producer);
 const rows=[],add=(id,area,engine,values,cold,proof,metrics=null)=>rows.push(benchmark({id:producer+'/'+id,area,engine,samples:values,coldSamples:cold??[],checksum:sha(JSON.stringify(proof)),metrics}));
 if(input.correctness?.passed!==true)throw new Error('Producer correctness gate missing');
 if(producer==='benchmark-il.js'){
  for(const row of input.pipeline??[])for(const key of ['compile','emit','decode','verification','loadTotal','oneFileEditAnalysis'])add(row.approximateLines+'/'+key,'A02','node',row[key].rawSamples,row[key].coldSamples,{lines:row.approximateLines,phase:key});
  for(const row of input.execution??[])for(const [key,engine] of [['irMs','source'],['ilMs','source-reloaded']])add(row.name.replaceAll(' ','-')+'/'+engine,'A05',engine,row.rawPairs?.map(pair=>pair[key]),[],{exitCode:row.exitCode,instructions:row.instructions,heapAllocations:row.heapAllocations});
 }else for(const [i,row] of (input.results??[]).entries()){
  const area=producer==='benchmark-compute14.js'?'A10':producer==='benchmark-release14.js'?'A08':producer==='benchmark-release06.js'?'A20':'A02';
  const name=(row.name??[row.type,row.elements,row.operation,row.backend].join('-')).replaceAll(' ','-').replaceAll(/[^a-zA-Z0-9_.:/-]/g,'_');
  add(String(i)+'-'+name,area,row.engine??row.backend??'node',row.rawSamples,row.coldSamples,row.output??row.checksum??row.correctness??{name},row.allocatedBytes===undefined?null:{managedAllocatedBytes:row.allocatedBytes});
 }
 return report(rows,env,{producer,unsupported:[{target:'historical summary-only reports',reason:'Discarded samples cannot be reconstructed from medians'}]});
}
if(isMain(import.meta.url)){const a=args();const result=normalize(a.producer,json(a.input),a.env?json(a.env):environment(a.root??repository));if(a.output)writeJson(a.output,result);else console.log(JSON.stringify(result));}
