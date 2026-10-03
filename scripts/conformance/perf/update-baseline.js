import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {args,isMain,repository,sha,validateReport,writeJson,git} from './core.js';
import {committedJson} from './size-budget.js';
export function updateBaseline({root=repository,rawPath,environmentPath,id,reviewUrl,reviewer,reason}={}){
 if(!rawPath||!environmentPath)throw new Error('Raw samples and an environment report are required');
 if(!/^[a-zA-Z0-9_-]+$/.test(id??'')||!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(reviewUrl??'')||!reviewer||!reason)throw new Error('Baseline update requires review URL, reviewer and reason');
 const rawBytes=readFileSync(rawPath),envBytes=readFileSync(environmentPath),raw=validateReport(JSON.parse(rawBytes)),env=JSON.parse(envBytes);
 if(JSON.stringify(raw.environment)!==JSON.stringify(env))throw new Error('Environment report does not match raw evidence');
 if(raw.benchmarks.some(row=>row.samples.length<20))throw new Error('Baseline requires at least 20 actual samples for every workload');
 git(root,'cat-file','-e',raw.commit+'^{commit}');
 const directory=join(root,'planning/qualification/perf-baselines',id);
 const record={schemaVersion:1,id,commit:raw.commit,runnerId:raw.runnerId,rawDigest:sha(JSON.stringify(raw,null,2)+"\n"),environmentDigest:sha(JSON.stringify(env,null,2)+"\n"),review:{url:reviewUrl,reviewer,reason},raw:JSON.parse(rawBytes),environment:env};
 writeJson(join(directory,'baseline.json'),record);
 return record;
}
export function readBaseline(root,id,ref='HEAD'){
 if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new Error('Invalid baseline id');
 const record=committedJson(root,ref,'planning/qualification/perf-baselines/'+id+'/baseline.json');validateReport(record.raw);
 if(record.raw.commit!==record.commit||record.raw.runnerId!==record.runnerId||JSON.stringify(record.environment)!==JSON.stringify(record.raw.environment)||!record.review?.url||!record.review?.reviewer)throw new Error('Invalid committed baseline');
 // Stored evidence hashes are over the canonical baseline representation.
 if(record.rawDigest!==sha(JSON.stringify(record.raw,null,2)+'\n')||record.environmentDigest!==sha(JSON.stringify(record.environment,null,2)+'\n'))throw new Error('Baseline evidence digest mismatch');
 return record;
}
if(isMain(import.meta.url)){const a=args();console.log(JSON.stringify(updateBaseline({root:resolve(a.root??repository),rawPath:a.raw,environmentPath:a.env,id:a.id,reviewUrl:a['review-url'],reviewer:a.reviewer,reason:a.reason}),null,2));}
