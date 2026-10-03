import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {compileToIL} from '../../packages/compiler/src/index.js';
import {OpName} from '../../packages/bytecode/src/index.js';
import {VirtualMachine,CilVirtualMachine} from '../../packages/runtime/src/index.js';
export const fixtureRoot=new URL('../../planning/contracts/fixtures/safepoint/',import.meta.url);
export function forceCollections(vm,onAllocation=()=>{}){
  const reserve=vm.heap.reserve.bind(vm.heap),collect=vm.heap.collect.bind(vm.heap),pauses=[];
  vm.heap.collect=(roots=[])=>{const result=collect(roots);pauses.push(vm.heap.stats.lastPauseMs);return result;};
  vm.heap.reserve=(bytes,roots=[])=>{const pinned=[...roots];onAllocation();vm.heap.collect(pinned);return reserve(bytes,pinned);};
  const restore=()=>{vm.heap.reserve=reserve;vm.heap.collect=collect;};restore.pauses=pauses;return restore;
}
export async function runSafepointFixtures(){
  const results=[],failures=[];
  for(const fixture of JSON.parse(readFileSync(new URL('expectations.json',fixtureRoot)))){
    const compilation=compileToIL(readFileSync(new URL(fixture.id+'.cs',fixtureRoot),'utf8'));
    assert(compilation.success,JSON.stringify(compilation.diagnostics));
    for(const [engine,make] of [['source',()=>new VirtualMachine(compilation.image,{virtualTime:true,initialThreshold:64})],['cil',()=>new CilVirtualMachine(compilation.assembly,{virtualTime:true,initialThreshold:64})]]){
      const vm=make(),observed=new Set(),restore=forceCollections(vm,()=>observed.add(3));let polls=0,parked=false;
      try{
        if(fixture.id==='native-callback')await exerciseHostCallback(vm);
        while(!['terminated','faulted'].includes(vm.state)){
          if(++polls>20000)throw new Error('Fixture did not terminate');
          const frame=vm.top;let op,operand,offset;if(frame){if(vm.inspector){const instruction=frame.method.instructions[frame.pc];op=instruction?.name;operand=instruction?.operand;offset=instruction?.offset;}else{const code=vm.image.methods[frame.methodId].code;op=OpName[code[frame.pc*3]];operand=code[frame.pc*3+1];offset=frame.pc;}}
          if(/^(CALL|BUILTIN|call|callvirt|calli|RET|ret)$/.test(op))observed.add(2);
          if(/^(JUMP|JFALSE|JTRUE|br|leave)/.test(op)&&Number(operand)<=offset)observed.add(1);
          vm.heap.collect();vm.runSlice({instructionBudget:1,timeBudgetMs:100});observed.add(4);vm.heap.collect();
          if(vm.state==='waiting'){
            parked=true;observed.add(5);
            for(const text of fixture.liveAtPark)assert(vm.heap.records.some(r=>r?.kind==='string'&&r.data===text),'Missing parked root '+text);
            vm.scheduler.advance(10);
          }
          await Promise.resolve();
        }
        assert.equal(vm.output.join(''),fixture.output);
        if(fixture.fault)assert.equal(vm.fault?.message,fixture.fault);else assert.equal(vm.state,'terminated',vm.fault?.message);
        if(fixture.liveAtPark.length)assert(parked,'Parked-frame boundary not exercised');
        for(const kind of fixture.kinds)assert(observed.has(kind),'Safepoint kind not exercised: '+kind);
        results.push({fixture:fixture.id,engine,kinds:[...observed].sort(),status:'passed',gcLatency:latency(restore.pauses),polls,collections:vm.heap.stats.collections,allocations:vm.heap.stats.allocations,parked});
      }catch(error){
        error.message=`${fixture.id}/${engine}: ${error.message}`;failures.push(error);
        results.push({fixture:fixture.id,engine,status:'failed',gcLatency:latency(restore.pauses),message:error.message,polls,collections:vm.heap.stats.collections,allocations:vm.heap.stats.allocations,parked});
      }finally{restore();vm.stop();}
    }
  }
  if(failures.length){const error=new AggregateError(failures,failures.map(e=>e.message).join('; '));error.results=results;throw error;}
  return results;
}
function latency(values){const coldMs=values[0]??0,warm=values.slice(1).sort((a,b)=>a-b),at=p=>warm[Math.min(warm.length-1,Math.floor(warm.length*p))]??0;return {coldMs,warmMedianMs:at(0.5),p95Ms:at(0.95),p99Ms:at(0.99),samples:values.length};}
async function exerciseHostCallback(vm){
  const witness=vm.heap.string('host-callback-root');
  const task=vm.heap.withRoots([witness],()=>vm.platform.hostOperations.start('string',()=>{vm.heap.collect();assert.equal(vm.heap.get(witness).data,'host-callback-root');return Promise.resolve('done');},()=>{vm.heap.collect();assert.equal(vm.heap.get(witness).data,'host-callback-root');return witness;},[witness],'contract'));
  const lease=vm.heap.createHandle(task);
  try{for(let i=0;vm.platform.hostOperations.active.size&&i<20;i++){vm.heap.collect();await Promise.resolve();}assert.equal(vm.scheduler.taskRecord(task).status,'completed');assert.equal(vm.scheduler.taskRecord(task).result,witness);}finally{vm.heap.releaseHandle(lease);}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await runSafepointFixtures(),null,2));}
  catch(error){console.error(JSON.stringify({message:error.message,results:error.results},null,2));process.exitCode=1;}
}
