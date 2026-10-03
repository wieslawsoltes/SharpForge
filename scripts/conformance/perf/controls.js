/** Actual timed statistical calibration; controlled delay is not a product/native benchmark. */
import assert from 'node:assert/strict';
import {compare} from './compare.js';
import {args,isMain,clean,environment,benchmark,report,writeJson,repository} from './core.js';
export function controls(root=repository){
 const head=clean(root),env=environment(root),results=[];
 const action=duration=>{const start=performance.now();let sum=0;for(let i=0;i<100;i++)sum+=i;assert.equal(sum,4950);while(performance.now()-start<duration){}return performance.now()-start;};
 for(let i=0;i<20;i++)action(2);
 const record=samples=>report([benchmark({id:'A29/timed-calibration',area:'A29',engine:'controlled-node-delay-not-product',samples,coldSamples:[],checksum:'4950'})],env);
 for(let trial=0;trial<20;trial++){
  const base=[],same=[],slow=[];for(let pair=0;pair<20;pair++){if(pair%2){same.push(action(2));base.push(action(2));}else{base.push(action(2));same.push(action(2));}slow.push(action(2.3));}
  const a=record(base),aa=record(same),b=record(slow),equal=compare(a,aa),injected=compare(a,b);
  results.push({trial,base:a,same:aa,injected:b,aa:equal,slowdown:injected});
 }
 if(clean(root)!==head)throw new Error('Calibration checkout changed');
 return {schemaVersion:1,commit:head,scope:'Actual timed 2ms/2.3ms controlled delay; validates statistics only, no product/native qualification',passed:results.every(r=>r.aa.passed&&!r.slowdown.passed),trials:results};
}
if(isMain(import.meta.url)){const a=args(),result=controls(a.root??repository);writeJson(a.output??'artifacts/results/performance/controls.json',result);console.log(JSON.stringify({passed:result.passed,trials:result.trials.length,aaRegressions:result.trials.filter(r=>!r.aa.passed).length,slowdownDetections:result.trials.filter(r=>!r.slowdown.passed).length}));if(!result.passed)process.exitCode=1;}
