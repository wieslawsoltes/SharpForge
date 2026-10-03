import {compile,compileToIL} from '../../../../packages/compiler/src/index.js';
import {CilError} from '../../../../packages/cil/src/index.js';
import {VirtualMachine,CilVirtualMachine} from '../../../../packages/runtime/src/index.js';
import {performance} from 'node:perf_hooks';
import {result,failure,unsupported} from '../result.js';
import {sha256} from '../fixtures.js';
export const compileOptions=fixture=>({name:'Differential',langVersion:fixture.langVersion,framework:'net8',includeDebug:false,portablePdb:false,embedSources:false});
export function compileSharp(fixture){return compileToIL(fixture.sourceText,compileOptions(fixture));}
const diagnostics=rows=>rows.map(d=>({code:d.code,severity:d.severity,message:d.message,start:d.start??null,end:d.end??null}));
export async function runVM(engine,fixture,{signal,compiled,sharedCompileMs}={}){
  if(signal?.aborted)return failure(engine,{code:'cancelled',message:'Cancelled before compilation'});
  if(fixture.stdin!==''||fixture.capabilities.includes('console.stdin'))return unsupported(engine,'This VM profile has no stdin service; the same fixture still runs on native CLR.');
  let vm,timer,compilation;const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});
  const start=performance.now();let phase='compile',compileMs;
  try{
    compilation=compiled??(engine==='source-vm'?compile(fixture.sourceText,compileOptions(fixture)):compileSharp(fixture));compileMs=compiled?(sharedCompileMs??0):performance.now()-start;
    if(!compilation.success)return result(engine,{status:'compile-error',phase,exitCode:null,diagnostics:diagnostics(compilation.diagnostics),metrics:{compileMs}});
    phase='execute';const budget=fixture.limits;
    vm=engine==='source-vm'?new VirtualMachine(compilation.image,{maxInstructions:budget.maxInstructions,maxFrames:budget.maxFrames,maxBytes:budget.maxHeapBytes,maxOutputCharacters:budget.maxOutputBytes,scheduler:{virtualTime:true},network:{enabled:false}}):new CilVirtualMachine(compilation.assembly,{maxInstructions:budget.maxInstructions,maxFrames:budget.maxFrames,maxBytes:budget.maxHeapBytes,maxOutputCharacters:budget.maxOutputBytes,scheduler:{virtualTime:true},network:{enabled:false}});
    const at=performance.now();let timedOut=false;timer=setTimeout(()=>{timedOut=true;controller.abort();},budget.timeoutMs);
    let run;try{run=await vm.runAsync({signal:controller.signal});}catch(error){if(controller.signal.aborted)throw Object.assign(error,{code:timedOut?'budget-exceeded':'cancelled'});throw error;}
    const fault=run.fault,budgetFault=fault&&['InstructionLimitException','OutputLimitException','StackOverflowException','ExecutionLimitException','OutOfMemoryException'].includes(fault.name);
    if(Buffer.byteLength(run.output)>budget.maxOutputBytes)return result(engine,{status:'budget-exceeded',phase,exitCode:null,error:'VM output byte budget exceeded'});
    return result(engine,{status:budgetFault?'budget-exceeded':fault?'runtime-error':run.state==='terminated'?'completed':'host-error',phase,stdout:run.output,exitCode:fault?null:run.exitCode,exception:fault?{type:fault.name,message:fault.message}:null,...(run.state==='waiting'?{error:'VM stalled with unresolved host work'}:{}),artifactHash:compilation.assembly?sha256(compilation.assembly):null,metrics:{compileMs,executeMs:performance.now()-at,instructions:vm.instructions,managedAllocations:vm.heap.stats.allocations??null,managedAllocatedBytes:vm.heap.stats.allocatedBytes??null,heap:vm.heap.stats}});
  }catch(error){if(error instanceof CilError&&compilation?.assembly)return result(engine,{status:'runtime-error',phase:'load',exitCode:null,exception:{type:'CilVerificationError',message:error.message},artifactHash:sha256(compilation.assembly),metrics:{compileMs}});return {...failure(engine,error,phase),metrics:{compileMs:compileMs??performance.now()-start}};}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);vm?.stop();}
}
