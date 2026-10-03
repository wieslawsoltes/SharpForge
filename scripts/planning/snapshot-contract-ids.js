import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {contracts} from '@sharpforge/framework';
import {Op,Binary,Unary,Builtins,CONTRACT_BUILTIN_OFFSET} from '@sharpforge/bytecode';
export function snapshotContractIds(){
  return {framework:contracts.map(({id,owner,name,parameters,kind})=>({id,owner,name,parameters,kind})),bytecode:{Op,Binary,Unary,contractOffset:CONTRACT_BUILTIN_OFFSET,Builtins:Builtins.filter(Boolean).map(({id,name,min,max,result,params})=>({id,name,min,max,result,params}))}};
}
export function checkContractIds(expected,actual){
  for(const locked of expected.framework){const current=actual.framework.find(d=>d.id===locked.id);if(JSON.stringify(locked)!==JSON.stringify(current))throw new Error('Framework ABI changed at id '+locked.id);}
  for(const table of ['Op','Binary','Unary'])for(const [name,id]of Object.entries(expected.bytecode[table]))if(actual.bytecode[table][name]!==id)throw new Error(table+' numbering changed at '+name+' ('+id+')');
  if(expected.bytecode.contractOffset!==actual.bytecode.contractOffset)throw new Error('Contract builtin offset changed from '+expected.bytecode.contractOffset);
  for(const locked of expected.bytecode.Builtins){const current=actual.bytecode.Builtins.find(d=>d.id===locked.id);if(JSON.stringify(locked)!==JSON.stringify(current))throw new Error('Builtin ABI changed at id '+locked.id);}
  return true;
}
export async function snapshotMain(args=process.argv.slice(2)){
  const directory=new URL('../../planning/contracts/',import.meta.url),actual=snapshotContractIds();
  if(args.includes('--write')){await mkdir(directory,{recursive:true});for(const [name,data]of Object.entries(actual))await writeFile(new URL(name+'-ids.lock.json',directory),JSON.stringify(data,null,2)+'\n');}
  else{const expected={};for(const name of ['framework','bytecode'])expected[name]=JSON.parse(await readFile(new URL(name+'-ids.lock.json',directory),'utf8'));checkContractIds(expected,actual);if(args.includes('--strict'))for(const name of ['framework','bytecode'])if(!isDeepStrictEqual(expected[name],actual[name]))throw new Error(name+' lock drift: regenerate the reviewed additive snapshot');console.log(`ABI locks match: ${actual.framework.length} contracts, ${actual.bytecode.Builtins.length} builtins`);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await snapshotMain();
