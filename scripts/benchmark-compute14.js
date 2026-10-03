/** Same-process scalar/SIMD timings include input copies and output allocation.
 * Worker timings also include startup, queueing and ownership copies. Not a native .NET comparison.
 */
import assert from 'node:assert/strict';
import {createSimdEngine,ComputePool} from '@sharpforge/compute';
const results=[];
for(const C of [Int32Array,Float64Array])for(const n of [4,1024,100000,1000000])for(const op of ['add','dot']){
 const a=C.from({length:n},(_,i)=>i%17),b=C.from({length:n},(_,i)=>i%7);const iterations=n>100000?5:n>1024?10:100;
 for(const backend of ['scalar','wasm']){const engine=createSimdEngine({backend});const coldStart=performance.now();engine.execute(op,a,b);const coldSamples=[performance.now()-coldStart];for(let i=0;i<3;i++)engine.execute(op,a,b);const times=[];let value;
  for(let t=0;t<5;t++){const start=performance.now();for(let i=0;i<iterations;i++)value=engine.execute(op,a,b);times.push((performance.now()-start)/iterations);}const rawSamples=[...times];if(op==='add'){for(let i=0;i<n;i++)assert.equal(value[i],a[i]+b[i]);}else{let expected=0;for(let i=0;i<n;i++)expected+=a[i]*b[i];assert.equal(value,expected);}times.sort((a,b)=>a-b);results.push({rawSamples,coldSamples,type:C.name,elements:n,operation:op,backend:engine.backend,medianMs:times[2],iterations,checksum:ArrayBuffer.isView(value)?value[0]+value[value.length-1]:value});
 }
}
const pool=new ComputePool({workers:2,backend:'wasm'});let worker;
try{const start=performance.now();await pool.init();const startupMs=performance.now()-start,a=new Float64Array(100000).fill(.5),begin=performance.now();const values=await Promise.all(Array.from({length:8},()=>pool.execute('sum',a)));assert(values.every(value=>value===50000));const totalEightJobsMs=performance.now()-begin;worker={startupMs,totalEightJobsMs,startupRawSamples:[startupMs],eightJobsRawSamples:[totalEightJobsMs],values,capabilities:await pool.capabilities()};}finally{pool.dispose();}
console.log(JSON.stringify({correctness:{passed:true},node:process.version,results,worker,scope:'Synthetic same-host microbenchmark; copies and result allocation included; not a browser or CLR benchmark. Fixed-width SIMD reduction order is shared with scalar fallback.'},null,2));
