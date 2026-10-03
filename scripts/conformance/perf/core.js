import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {validate} from '../../planning/schema/validate.js';
export const repository=fileURLToPath(new URL('../../../',import.meta.url));
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const json=path=>JSON.parse(readFileSync(path,'utf8'));
export function writeJson(path,value){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(value,null,2)+'\n');}
export function git(root,...args){return execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:30000}).trim();}
export function commit(root){return git(root,'rev-parse','--verify','HEAD');}
export function clean(root){if(git(root,'status','--porcelain','--untracked-files=all'))throw new Error('Performance capture requires a clean checkout');return commit(root);}
export function environment(root=repository){return {node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model??'unknown',logicalCpus:os.cpus().length,osRelease:os.release(),runnerName:process.env.RUNNER_NAME??os.hostname(),commit:commit(root)};}
export function runnerId(env){return sha(JSON.stringify({...env,commit:undefined})).slice(0,24);}
export function samples(values,label='samples'){if(!Array.isArray(values)||!values.length||values.length>100000||values.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0))throw new TypeError(label+': expected 1–100000 finite nonnegative measurements');return values;}
export function distribution(values){const ordered=[...samples(values)].sort((a,b)=>a-b),n=ordered.length,q=p=>ordered[Math.max(0,Math.ceil(p*n)-1)];return {count:n,median:n%2?ordered[(n-1)/2]:(ordered[n/2-1]+ordered[n/2])/2,p95:q(.95),p99:q(.99),min:ordered[0],max:ordered.at(-1)};}
export function benchmark({id,area,engine,samples:raw,coldSamples=[],checksum,metrics=null}){samples(raw);if(coldSamples.length)samples(coldSamples);if(typeof checksum!=='string'||!checksum)throw new Error('A correctness checksum is required');return {id,area,engine,unit:'ms',samples:raw,coldSamples,statistics:distribution(raw),correctness:{passed:true,checksum},metrics};}
export function report(benchmarks,env,extra={}){const value={schemaVersion:1,harnessCommit:commit(repository),runnerId:runnerId(env),commit:env.commit,environment:env,benchmarks,unsupported:[],...extra};validateReport(value);return value;}
export function validateReport(value){
 validate(json(resolve(repository,'planning/qualification/benchmark.schema.json')),value);
 if(value?.schemaVersion!==1||!/^[a-f0-9]{40,64}$/.test(value.commit??'')||typeof value.runnerId!=='string'||!value.runnerId||!value.environment||value.environment.commit!==value.commit)throw new Error('Malformed benchmark identity');
 for(const key of ['node','platform','arch','cpu','osRelease','runnerName'])if(typeof value.environment[key]!=='string'||!value.environment[key])throw new Error('Missing environment '+key);
 if(!Array.isArray(value.benchmarks)||!value.benchmarks.length)throw new Error('No benchmark evidence');
 const ids=new Set();
 for(const row of value.benchmarks){
  if(!/^[\w./:-]+$/.test(row.id??'')||ids.has(row.id)||!/^A\d{2}$/.test(row.area??'')||typeof row.engine!=='string'||row.unit!=='ms')throw new Error('Invalid/duplicate benchmark '+row.id);
  ids.add(row.id);samples(row.samples);if(!Array.isArray(row.coldSamples))throw new Error('Missing cold samples');if(row.coldSamples.length)samples(row.coldSamples);
  if(JSON.stringify(row.statistics)!==JSON.stringify(distribution(row.samples)))throw new Error('Statistics do not match raw samples');
  if(row.correctness?.passed!==true||typeof row.correctness.checksum!=='string'||!row.correctness.checksum)throw new Error('Correctness did not pass');
 }
 if(!Array.isArray(value.unsupported)||value.unsupported.some(x=>!x.target||!x.reason))throw new Error('Unsupported targets need reasons');
 return value;
}
export function args(argv=process.argv.slice(2)){const result={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))throw new Error('Expected --option');const key=argv[i].slice(2);if(!argv[i+1]||argv[i+1].startsWith('--'))result[key]=true;else result[key]=argv[++i];}return result;}
export function integer(value,fallback,min,max){const n=value===undefined?fallback:Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error('Integer must be between '+min+' and '+max);return n;}
export const isMain=url=>process.argv[1]&&fileURLToPath(url)===resolve(process.argv[1]);
