import {performance} from 'node:perf_hooks';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {compileToIL} from '../../../packages/compiler/src/index.js';
import {AssemblyInspector} from '../../../packages/cil/src/index.js';
import {methodBody,validateBody} from './adapters.js';
const results=[];
for(const id of ['native-callback','nested-finally','parked-frame']){
  const source=readFileSync(new URL('../../../planning/contracts/fixtures/safepoint/'+id+'.cs',import.meta.url),'utf8'),compiled=compileToIL(source);
  if(!compiled.success)throw new Error(JSON.stringify(compiled.diagnostics));
  const inspector=new AssemblyInspector(compiled.assembly);
  for(const encoding of ['bytecode','cil']){
    const methods=encoding==='bytecode'?compiled.image.methods:[...inspector.methods.keys()].map(t=>inspector.getMethod(t)).filter(m=>m.instructions.length),context=encoding==='bytecode'?{image:compiled.image}:{inspector};
    const lower=()=>methods.map(method=>methodBody(method,encoding,context));
    const start=performance.now(),cold=lower(),coldMs=performance.now()-start;for(const body of cold)validateBody(body,{requireExecutable:true});
    const baseline=JSON.stringify(cold),samples=[],before=process.memoryUsage().heapUsed;let instructionRecords=0;
    for(let i=0;i<100;i++){const at=performance.now(),bodies=lower();samples.push(performance.now()-at);for(const body of bodies){validateBody(body,{requireExecutable:true});instructionRecords+=body.instructions.length;}if(JSON.stringify(bodies)!==baseline)throw new Error('Lowering lost determinism');}
    samples.sort((a,b)=>a-b);results.push({fixture:id,encoding,methods:methods.length,instructions:cold.reduce((n,b)=>n+b.instructions.length,0),coldMs,warmMedianMs:samples[50],p95Ms:samples[95],p99Ms:samples[99],iterations:100,outputInstructionRecordAllocations:instructionRecords,heapUsedDeltaBytes:process.memoryUsage().heapUsed-before,serializedBodyBytes:Buffer.byteLength(baseline)});
  }
}
console.log(JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,allocationScope:'Output instruction records counted exactly; temporary allocations and heap deltas are not exact allocator accounting',results},null,2));
