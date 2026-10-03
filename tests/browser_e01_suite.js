import {compileToIL} from '../packages/compiler/src/index.js';
import {loadAssembly} from '../packages/cil/src/index.js';
import {VirtualMachine,CilVirtualMachine} from '../packages/runtime/src/index.js';
import {Builtins,Op} from '../packages/bytecode/src/index.js';

const engines=['source','reloaded-source','cil'];
const normalize=value=>value.replaceAll('\r\n','\n');
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
function require(value,message,details={}) {if(!value){const error=new Error(message);error.details=details;throw error;}}
function compiled(source) {const result=compileToIL(source);require(result.success,'Browser compilation failed',{diagnostics:result.diagnostics,source});return result;}
function machine(engine,result,options={}) {
  if(engine==='cil')return new CilVirtualMachine(result.assembly,options);
  return new VirtualMachine(engine==='source'?result.image:loadAssembly(result.assembly),options);
}
function assertResult(vm,expected) {
  require(vm.state==='terminated','Managed execution did not terminate',{state:vm.state,fault:vm.fault?.stack,output:vm.output.join('')});
  require(normalize(vm.output.join(''))===normalize(expected),'Managed output differs',{expected,actual:vm.output.join(''),instructions:vm.instructions});
}
function bytes(base64) {return Uint8Array.from(atob(base64),character=>character.charCodeAt(0));}
function percentile(values,fraction) {const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*fraction))];}
function prepareSort(engine,length,{observer=false}={}) {
  const result=compiled('class P { static void Observe(){Console.WriteLine("observer");} static void Main(){int[] values=new int[0];Array.Sort(values);} }');
  const vm=machine(engine,result,{schedulerQuantum:1,virtualTime:true,maxInstructions:20000000});
  let reached=false;
  for(let i=0;i<512&&vm.top;i++) {
    const frame=vm.top;
    if(engine==='cil') {
      const instruction=frame.method.instructions[frame.pc];
      if(['call','callvirt'].includes(instruction?.name)){
        const descriptor=vm.inspector.resolveToken(instruction.operand);
        reached=descriptor.owner==='System.Array'&&descriptor.name==='Sort';
      }
    } else {
      const code=vm.image.methods[frame.methodId].code,offset=frame.pc*3;
      reached=code[offset]===Op.BUILTIN&&Builtins[code[offset+1]].name==='Array.Sort';
    }
    if(reached)break;vm.runSlice({instructionBudget:1,timeBudgetMs:1000});
  }
  require(reached,'Could not pause at Array.Sort',{engine,state:vm.state,fault:vm.fault?.stack});
  // Managed input allocation and population are outside the timed slices.
  const reference=vm.heap.array('int',length),data=vm.heap.get(reference).data;
  for(let index=0;index<length;index++)data[index]=length-index;
  const stack=engine==='cil'?vm.top.stack:vm.stack;stack[stack.length-1]=reference;
  vm.top.locals.fill(null);
  if(observer){
    const method=engine==='cil'?[...vm.inspector.methods.values()].find(item=>item.name==='Observe').token:vm.image.methods.find(item=>item.name==='Observe').id;
    const delegate=vm.platform.delegate('System.Action',method,null);vm.scheduler.enqueue(delegate,[]);
  }
  return {vm,reference};
}

/** Actual browser compilation and VM execution; no expected result is computed by the runtime under test. */
export async function runE01Browser(manifest,onProgress=()=>{}) {
  const checks=[],started=performance.now();
  const check=async(name,engine,work)=>{
    const start=performance.now();let result;
    try{result={name,engine,passed:true,...await work()};}
    catch(error){result={name,engine,passed:false,error:{name:error.name,message:error.message,stack:error.stack},details:error.details??null};}
    result.milliseconds=performance.now()-start;checks.push(result);onProgress(result);await pause();
  };
  for(const fixture of manifest.scalars)for(const nativeIntBits of [32,64])for(const engine of engines)
    await check('T01 '+fixture.name+' ABI'+nativeIntBits,engine,()=>{
      const vm=machine(engine,compiled(fixture.source),{nativeIntBits});vm.run();
      assertResult(vm,fixture.outputs?.[nativeIntBits]??fixture.output);return {nativeIntBits,instructions:vm.instructions,output:vm.output.join('')};
    });
  for(const engine of engines)await check('T06 parked await snapshots retain arrays through GC and cancellation',engine,async()=>{
    const vm=machine(engine,compiled(manifest.awaitSource),{virtualTime:true});vm.run();
    require(vm.state==='waiting','Expected a parked await',{state:vm.state,fault:vm.fault?.stack});
    vm.heap.collect();const saved=vm.snapshot();require(saved.scheduler.contexts.some(([,context])=>context.status==='waiting'),'No waiting logical context was captured');vm.stop();
    const replays=[];
    for(let replay=0;replay<2;replay++){
      vm.restore(saved);if(vm.state==='paused')vm.state='running';vm.heap.collect();await vm.runAsync();assertResult(vm,manifest.awaitOutput);
      replays.push({output:vm.output.join(''),instructions:vm.instructions,collections:vm.heap.stats.collections});
    }
    return {schemaVersion:saved.schemaVersion,replays};
  });
  for(const fixture of manifest.synchronization)for(const quantum of [1,7,256])for(const engine of engines)
    await check('T30 '+fixture.name+' quantum '+quantum,engine,async()=>{
      const vm=machine(engine,compiled(fixture.source),{virtualTime:true,schedulerQuantum:quantum,nativeIntBits:64});
      await vm.runAsync();assertResult(vm,fixture.output);return {quantum,instructions:vm.instructions,output:vm.output.join(''),contentions:String(vm.sync.contentions)};
    });
  for(const engine of engines){
    await check('T31 one-unit budgets, fairness, parked intrinsic GC and snapshot',engine,()=>{
      const {vm,reference}=prepareSort(engine,100000,{observer:true});
      const initial=vm.instructions;vm.runSlice({instructionBudget:0,timeBudgetMs:8});vm.runSlice({instructionBudget:100,timeBudgetMs:0});require(vm.instructions===initial,'Zero budgets executed work');
      const deltas=[];
      for(let i=0;i<256&&vm.output.join('')!=='observer\n';i++){
        const before=vm.instructions;vm.runSlice({instructionBudget:1,timeBudgetMs:8});const delta=vm.instructions-before;deltas.push(delta);require(delta<=1,'Slice exceeded its one-unit budget',{deltas});
      }
      require(vm.output.join('')==='observer\n','Observer starved behind Array.Sort',{deltas,output:vm.output.join('')});
      require(vm.scheduler.allFrames().some(frame=>frame.intrinsicContinuation),'Sort completed before fairness was observed');
      vm.heap.collect();require(vm.heap.get(reference).data.length===100000,'Parked sort lost its root');
      const snapshot=vm.snapshot();vm.restore(snapshot);require(vm.scheduler.allFrames().some(frame=>frame.intrinsicContinuation),'Restore lost parked continuation');vm.stop();
      return {deltas,observerAfterWork:deltas.reduce((sum,value)=>sum+value,0)};
    });
    await check('T31 one-million-element sort: every 8ms slice must finish within 16ms',engine,async()=>{
      const {vm,reference}=prepareSort(engine,1000000),samples=[],deltas=[],start=performance.now();
      while(['ready','running'].includes(vm.state)){
        const before=vm.instructions,at=performance.now();vm.runSlice({instructionBudget:15000,timeBudgetMs:8});samples.push(performance.now()-at);deltas.push(vm.instructions-before);
        require(performance.now()-start<180000,'Sort exceeded the overall browser deadline',{samples,deltas,state:vm.state,fault:vm.fault?.stack});await pause();
      }
      const details={elements:1000000,timeBudgetMs:8,maximumAllowedMs:16,samples,instructionDeltas:deltas,firstSliceMs:samples[0],medianMs:percentile(samples,.5),p95Ms:percentile(samples,.95),p99Ms:percentile(samples,.99),maximumMs:Math.max(...samples),instructions:vm.instructions};
      require(vm.state==='terminated','Sort faulted',{...details,state:vm.state,fault:vm.fault?.stack});
      require(vm.heap.get(reference).data.every((value,index)=>value===index+1),'Sort order is wrong',details);
      require(samples.length>1&&deltas.every(value=>value<=15000),'Sort did not obey slice work budgets',details);
      require(details.maximumMs<=16,'A measured slice exceeded twice its time budget; no samples were discarded',details);return details;
    });
    await check('T31 runAsync cancellation releases the pending sort',engine,async()=>{
      const {vm,reference}=prepareSort(engine,100000),controller=new AbortController();let failure=null;
      try{await vm.runAsync({signal:controller.signal,onSlice:()=>controller.abort()});}catch(error){failure=error;}
      require(failure?.name==='OperationCanceledException','Abort was not propagated',{error:failure?.stack,state:vm.state});
      require(vm.state==='terminated'&&vm.frames.length===0,'Cancellation retained active frames');vm.heap.collect();let stale=false;
      try{vm.heap.get(reference);}catch(error){stale=error.name==='InvalidReferenceException';}
      require(stale,'Canceled continuation retained its array');return {state:vm.state,error:failure.name};
    });
  }
  for(const fixture of manifest.assemblies)await check(fixture.label,'cil',async()=>{
    const vm=new CilVirtualMachine(bytes(fixture.base64),{nativeIntBits:fixture.nativeIntBits??64,virtualTime:true});await vm.runAsync();assertResult(vm,fixture.output);
    if(fixture.returnValue!==undefined)require(String(vm.returnValue)===String(fixture.returnValue),'DLL return value differs',{expected:fixture.returnValue,actual:String(vm.returnValue)});
    return {assemblySha256:fixture.sha256,origin:fixture.origin,output:vm.output.join(''),returnValue:String(vm.returnValue),instructions:vm.instructions};
  });
  return {passed:checks.every(item=>item.passed),checks,milliseconds:performance.now()-started,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,
    execution:'classic worker; actual static bundle, source compiler, reloaded source VM and direct CIL VM',nativeQualification:false};
}
