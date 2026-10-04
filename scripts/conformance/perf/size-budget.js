import {readdir,lstat,readFile} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {loadBuildContributions} from '../../build-contributions.js';
import {discoverPackages} from '../../verify-packages.js';
import {args,isMain,repository,git,writeJson,sha} from './core.js';
export async function size(path){const info=await lstat(path);if(info.isSymbolicLink())throw new Error('Artifact symlink forbidden: '+path);if(info.isFile())return info.size;if(!info.isDirectory())throw new Error('Unsupported artifact: '+path);let total=0;for(const name of await readdir(path))total+=await size(join(path,name));return total;}
export function checkSizes(actual,policy){
 if(policy?.schemaVersion!==1||!Array.isArray(policy.budgets))throw new Error('Malformed size budgets');
 const map=new Map();for(const b of policy.budgets){if(typeof b.id!=='string'||map.has(b.id)||!Number.isSafeInteger(b.maxBytes)||b.maxBytes<1)throw new Error('Invalid size budget '+b.id);map.set(b.id,b.maxBytes);}
 const seen=new Set(),results=[];
 for(const item of actual){if(seen.has(item.id)||!Number.isSafeInteger(item.bytes)||item.bytes<0)throw new Error('Invalid measured artifact '+item.id);seen.add(item.id);const maxBytes=map.get(item.id);if(maxBytes===undefined)throw new Error('Missing reviewed budget: '+item.id);results.push({...item,maxBytes,delta:item.bytes-maxBytes,passed:item.bytes<=maxBytes});}
 for(const id of map.keys())if(!seen.has(id))throw new Error('Budgeted artifact missing: '+id);
 return {schemaVersion:1,passed:results.every(x=>x.passed),artifacts:results};
}
export function committedJson(root,ref,path){if(!/^[a-zA-Z0-9_./-]+$/.test(path)||path.includes('..'))throw new Error('Unsafe policy path');return JSON.parse(git(root,'show',ref+':'+path));}
export async function artifactSizes(root=repository){
 const artifacts=[{id:'dist',path:'dist'},{id:'standalone',path:'artifacts/SharpForge-standalone.html'}],contributions=await loadBuildContributions(root);
 for(const worker of contributions.workers)artifacts.push({id:'worker:'+worker.entry,path:'dist/'+worker.entry});
 for(const pkg of await discoverPackages(root)){const manifest=JSON.parse(await readFile(join(root,pkg.directory,'package.json'),'utf8'));artifacts.push({id:'package:'+pkg.name,path:'artifacts/'+pkg.name.replace(/^@/,'').replaceAll('/','-')+'-'+manifest.version+'.tgz'});}
 const measured=[];for(const artifact of artifacts)measured.push({...artifact,bytes:await size(resolve(root,artifact.path))});return measured;
}
export async function sizeBudget({root=repository,policyRef='HEAD',policyPath='planning/qualification/size-budgets.json'}={}){const policy=committedJson(root,policyRef,policyPath),result=checkSizes(await artifactSizes(root),policy);return {...result,policyRef:git(root,'rev-parse',policyRef),policyDigest:sha(JSON.stringify(policy))};}
if(isMain(import.meta.url)){const a=args(),result=await sizeBudget({root:resolve(a.root??repository),policyRef:a['policy-ref']??'HEAD'});if(a.output)writeJson(a.output,result);for(const r of result.artifacts)console.log(r.id+': '+r.bytes+' / '+r.maxBytes+' bytes; delta '+r.delta+(r.passed?'':' OVER BUDGET'));if(!result.passed)process.exitCode=1;}
