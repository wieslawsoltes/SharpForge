import path from 'node:path';
import { readJSON,probeRoot,artifactRoot,writeJSON } from './common.js';
import { executeProbe } from './runtime-runner.js';
const fixture=(await readJSON(path.join(probeRoot,'runtime.json'))).fixtures.find(x=>x.id==='execution-array-positive'),rows=[];
for(const engine of ['js-source-vm','js-cil-vm']) {
  const samples=[];
  for(let i=0;i<31;i++) { const result=await executeProbe(fixture,engine);if(result.status!=='pass')throw new Error(`Benchmark correctness gate failed: ${engine}: ${JSON.stringify(result)}`);samples.push(result); }
  const warm=samples.slice(1).map(x=>x.elapsedMs).sort((a,b)=>a-b),at=p=>warm[Math.ceil(p*warm.length)-1];
  rows.push({engine,scope:'compile + construct VM + execute asserted fixture + managed allocation accounting',samples:30,coldMs:samples[0].elapsedMs,warmMedianMs:at(.5),p95Ms:at(.95),p99Ms:at(.99),allocations:samples.map(x=>x.managedAllocations)});
}
await writeJSON(path.join(artifactRoot,`node-${process.platform}-${process.arch}`,'benchmark.json'),{schemaVersion:1,node:process.version,rows});
console.log(JSON.stringify(rows.map(({allocations,...row})=>row)));
