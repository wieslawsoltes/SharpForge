import {distribution,validateReport} from './core.js';
/** Exact one-sided paired sign test. No random resampling or discarded outliers. */
export function signProbability(positive,total){let p=2**(-total),sum=0;for(let k=0;k<=total;k++){if(k>=positive)sum+=p;p=p*(total-k)/(k+1);}return Math.min(1,sum);}
export function compare(base,head,{threshold=.05,alpha=.01,minSamples=20,quarantine=[]}={}){
 validateReport(base);validateReport(head);
 if(base.harnessCommit!==head.harnessCommit||base.runnerId!==head.runnerId||JSON.stringify({...base.environment,commit:null})!==JSON.stringify({...head.environment,commit:null}))throw new Error('A/B requires the same runner and environment');
 if(!Number.isFinite(threshold)||threshold<0||threshold>1||!(alpha>0&&alpha<1)||!Number.isInteger(minSamples)||minSamples<3)throw new Error('Invalid comparison policy');
 const ids=new Set(),rows=[];
 for(const q of quarantine){if(!q.id||!q.reason||!q.expires||!Number.isFinite(Date.parse(q.expires))||Date.parse(q.expires)<=Date.now()||ids.has(q.id))throw new Error('Invalid/expired quarantine');ids.add(q.id);}
 if(base.benchmarks.length!==head.benchmarks.length)throw new Error('Benchmark set mismatch');
 for(const before of base.benchmarks){
  const after=head.benchmarks.find(row=>row.id===before.id);if(!after||before.engine!==after.engine||before.area!==after.area||before.correctness.checksum!==after.correctness.checksum)throw new Error('Correctness/target mismatch: '+before.id);
  const n=before.samples.length;if(n!==after.samples.length||n<minSamples)throw new Error('Insufficient paired raw samples: '+before.id);
  const ratios=before.samples.map((v,i)=>v===0?(after.samples[i]===0?1:Infinity):after.samples[i]/v);
  const positive=ratios.filter(r=>r>1).length,negative=ratios.filter(r=>r<1).length,pValue=signProbability(positive,positive+negative);
  const b=distribution(before.samples),h=distribution(after.samples),relative=b.median===0?(h.median===0?0:Infinity):h.median/b.median-1;
  const regression=relative>threshold&&pValue<alpha,quarantined=ids.has(before.id);
  rows.push({id:before.id,engine:before.engine,base:b,head:h,relative:Number.isFinite(relative)?relative:null,pValue,threshold,verdict:regression?(quarantined?'quarantined':'regression'):'pass',quarantine:quarantined?quarantine.find(q=>q.id===before.id):null});
 }
 return {schemaVersion:1,baseCommit:base.commit,headCommit:head.commit,runnerId:base.runnerId,policy:{threshold,alpha,minSamples,test:'one-sided paired sign test'},passed:rows.every(row=>row.verdict!=='regression'),rows};
}
export function summary(result){return '| Benchmark | Base median | Head median | Head p95 | Head p99 | Change | p | Verdict |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n'+result.rows.map(r=>'| '+r.id+' | '+r.base.median.toFixed(3)+' | '+r.head.median.toFixed(3)+' | '+r.head.p95.toFixed(3)+' | '+r.head.p99.toFixed(3)+' | '+(r.relative===null?'∞':(100*r.relative).toFixed(1)+'%')+' | '+r.pValue.toPrecision(3)+' | '+r.verdict+' |').join('\n')+'\n';}
