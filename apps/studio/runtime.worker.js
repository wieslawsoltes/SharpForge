import {createWorkerProtocol,readWorkerRequest} from './workers/protocol.js';
import {applyDesignPatch} from '@sharpforge/runtime';
import {createRuntimeExecutable,createRuntimeLaunchCandidate} from './workers/runtime-launch.js';
import {requireSingleAssemblyUpdate} from './workers/runtime-inputs.js';
import {runtimeSourceRecords} from './workers/runtime-sources.js';
import {RuntimeActivity} from './workers/runtime-activity.js';
const executable=createRuntimeExecutable();
let session=null,uiCommands=[],output=[],sessionSerial=0;
const activity=new RuntimeActivity({getSession:()=>session,getSerial:()=>sessionSerial,flush,publishState:state,
  onError:error=>self.postMessage({event:'error',sessionId:sessionSerial,message:error.message})});
function flush(){if(uiCommands.length){self.postMessage({event:'ui',sessionId:sessionSerial,commands:uiCommands});uiCommands=[];}if(output.length){self.postMessage({event:'output',sessionId:sessionSerial,text:output.join('')});output=[];}}
function state(){activity.observeState();flush();if(session)self.postMessage({event:'state',sessionId:sessionSerial,...session.state(),assemblyLoad:session.assemblyLoad??null});}
function schedule(){activity.schedule();}
function scheduleAnimations(){activity.scheduleAnimations();}
function launch(params){
  // Fully construct and bind a candidate first. A malformed replacement must not destroy a live session.
  const {candidate,capabilities}=createRuntimeLaunchCandidate(params,{
    executable,onOutput:text=>output.push(text),
    onUICommand:command=>{uiCommands.push(command);if(uiCommands.length>=1024)flush();}
  });
  activity.stop();session?.stop();session=candidate;sessionSerial++;output=[];uiCommands=[];self.postMessage({event:'ui',sessionId:sessionSerial,commands:[{op:'reset',snapshot:{version:1,windows:[],nodes:[]}}]});activity.start({manualAnimations:!!params.manualAnimations});
  self.postMessage({event:'loaded',sessionId:sessionSerial,sources:runtimeSourceRecords(session)});
  state();schedule();
  return {started:true,sessionId:sessionSerial,capabilities,profile:params.managedIL?'SharpForge.ManagedIL/1':'SharpForge.CIL',
    sources:runtimeSourceRecords(session)};
}
const handlers=createWorkerProtocol('runtime');
for(const method of ["launch"])handlers.registerHandler(method,(params,method)=>{let result;result=launch(params);return result;});
for(const method of ["resume"])handlers.registerHandler(method,(params,method)=>{let result;session.resume(params.mode,{granularity:params.granularity});state();schedule();return result;});
for(const method of ["pause"])handlers.registerHandler(method,(params,method)=>{let result;session.pause();state();return result;});
for(const method of ["stop"])handlers.registerHandler(method,(params,method)=>{let result;session?.stop();activity.stop();state();return result;});
for(const method of ["stepBack"])handlers.registerHandler(method,(params,method)=>{let result;session.stepBack();state();return result;});
for(const method of ["reverseContinue"])handlers.registerHandler(method,(params,method)=>{let result;session.reverseContinue();state();return result;});
for(const method of ["dataBreakpointInfo"])handlers.registerHandler(method,(params,method)=>{let result;result=session.dataBreakpointInfo(params);return result;});
for(const method of ["dataBreakpoints"])handlers.registerHandler(method,(params,method)=>{let result;result=session.setDataBreakpoints(params.breakpoints);state();return result;});
for(const method of ["breakpoints"])handlers.registerHandler(method,(params,method)=>{let result;result=session.setBreakpoints(params.uri,params.breakpoints);state();return result;});
for(const method of ["functionBreakpoints"])handlers.registerHandler(method,(params,method)=>{let result;result=session.setFunctionBreakpoints(params.breakpoints);state();return result;});
for(const method of ["breakpointLocations"])handlers.registerHandler(method,(params,method)=>{let result;result=session.breakpointLocations(params.uri,params);return result;});
for(const method of ["breakpointsEnabled"])handlers.registerHandler(method,(params,method)=>{let result;result=session.setBreakpointsEnabled(params.enabled);state();return result;});
for(const method of ["exceptionBreak"])handlers.registerHandler(method,(params,method)=>{let result;result=session.setExceptionBreakpoints({mode:params.mode,rules:params.rules??session.exceptionRules});state();return result;});
for(const method of ["instructionBreakpoints"])handlers.registerHandler(method,(params,method)=>{let result;result=session.setInstructionBreakpoints(params.breakpoints);state();return result;});
for(const method of ["runToInstruction"])handlers.registerHandler(method,(params,method)=>{let result;session.runToInstruction(params.reference);state();schedule();return result;});
for(const method of ["disassemblyMethods"])handlers.registerHandler(method,(params,method)=>{let result;result=session.vm.report.methods.map(token=>{const m=session.vm.inspector.getMethod(token);return {token,name:m.owner+'::'+m.name,count:m.instructions.length};});return result;});
for(const method of ["runToCursor"])handlers.registerHandler(method,(params,method)=>{let result;result=session.runToCursor(params.uri,params.line,params.column);state();schedule();return result;});
for(const method of ["disassemble"])handlers.registerHandler(method,(params,method)=>{let result;result=session.disassemble(params.reference,params);return result;});
for(const method of ["gotoTargets"])handlers.registerHandler(method,(params,method)=>{let result;result=session.gotoTargets(params);return result;});
for(const method of ["setNextStatement"])handlers.registerHandler(method,(params,method)=>{let result;result=session.setNextStatement(params);state();return result;});
for(const method of ["hotReload"])handlers.registerHandler(method,(params,method)=>{
  let result;
  requireSingleAssemblyUpdate(session,'Hot reload');
  result=session.applyChanges(params.image??params.assembly,{expectedVersion:params.expectedVersion});
  self.postMessage({event:'loaded',sessionId:sessionSerial,
    sources:runtimeSourceRecords(session)});
  state();
  return result;
});
for(const method of ["evaluateFunction"])handlers.registerHandler(method,(params,method)=>{let result;result=session.evaluateFunction(params.expression,{...params,allowSideEffects:params.allowSideEffects===true});state();return result;});
for(const method of ["loadSymbols"])handlers.registerHandler(method,(params,method)=>{
  let result;
  requireSingleAssemblyUpdate(session,'Symbol replacement');
  result=session.loadSymbols(params.pdb??null,params.sources??{});
  self.postMessage({event:'loaded',sessionId:sessionSerial,
    sources:runtimeSourceRecords(session)});
  state();
  return result;
});
for(const method of ["symbolInfo"])handlers.registerHandler(method,(params,method)=>{
  let result;
  result=session.symbolBinding?{id:session.symbols.idHex,
    documents:session.symbolBinding.documents.map(({embedded,hash,...d})=>({...d,text:undefined,hash:[...hash]})),
    methods:session.symbols.methods.length,stateMachines:session.symbols.stateMachines}:null;
  return result;
});
for(const method of ["threads"])handlers.registerHandler(method,(params,method)=>{let result;result=session.threads();return result;});
for(const method of ["parallelStacks"])handlers.registerHandler(method,(params,method)=>{let result;result=session.parallelStacks();return result;});
for(const method of ["stackTrace"])handlers.registerHandler(method,(params,method)=>{let result;result=session.stackTrace(params.threadId);return result;});
for(const method of ["freezeThread"])handlers.registerHandler(method,(params,method)=>{let result;result=session.freezeThread(params.threadId,params.frozen);state();schedule();return result;});
for(const method of ["uiEvent"])handlers.registerHandler(method,(params,method)=>{
  let result;
  if(session.vm.state==='paused')throw new Error('Continue execution before interacting with the managed application');
  result=session.vm.platform.dispatchEvent(params.id,params.event,params.payload);
  state();
  schedule();
  return result;
});
for(const method of ["uiAnimationAdvance"])handlers.registerHandler(method,(params,method)=>{
  let result;
  if(session.vm.state==='paused')throw new Error('Animation clock is frozen while paused');
  result=session.vm.platform.advanceAnimations(params.milliseconds);
  flush();
  schedule();
  scheduleAnimations();
  return result;
});
for(const method of ["uiAnimationMode"])handlers.registerHandler(method,(params,method)=>{let result;activity.manualAnimations=!!params.manual;scheduleAnimations();result={manual:activity.manualAnimations};return result;});
for(const method of ["runtimeInfo"])handlers.registerHandler(method,(params,method)=>{let result;result=session.vm.platform.runtimeInfo();return result;});
for(const method of ["uiScene"])handlers.registerHandler(method,(params,method)=>{let result;result=session.vm.platform.scene();return result;});
for(const method of ["designSnapshot"])handlers.registerHandler(method,(params,method)=>{let result;result={scene:session.vm.platform.scene(),revision:session.designRevision??0};return result;});
for(const method of ["applyDesign"])handlers.registerHandler(method,(params,method)=>{let result;result=applyDesignPatch(session,params.patch,{expectedRevision:params.expectedRevision});state();return result;});
for(const method of ["uiLayout"])handlers.registerHandler(method,(params,method)=>{let result;if(session.vm.state==='paused')result=0;else result=session.vm.platform.updateLayout(params.changes);return result;});
for(const method of ["evaluate"])handlers.registerHandler(method,(params,method)=>{let result;result=session.evaluate(params.expression,params.frameId);return result;});
for(const method of ["setVariable"])handlers.registerHandler(method,(params,method)=>{let result;result=session.setVariable(params.frameId,params.name,params.expression);state();return result;});
for(const method of ["locals"])handlers.registerHandler(method,(params,method)=>{let result;result=session.locals(params.frameId);return result;});
for(const method of ["children"])handlers.registerHandler(method,(params,method)=>{let result;result=session.children(params.reference,params.start??0,params.count??100);return result;});
for(const method of ["collect"])handlers.registerHandler(method,(params,method)=>{let result;result=session.collect();state();return result;});
for(const method of ["heapPage"])handlers.registerHandler(method,(params,method)=>{let result;result=session.vm.heap.inspectPage(params);return result;});
for(const method of ["heapCensus"])handlers.registerHandler(method,(params,method)=>{let result;result=session.vm.heap.census();return result;});
handlers.registerHandler('executionMetrics',params=>activity.execution.read(params));
for(const method of ["retentionPath"])handlers.registerHandler(method,(params,method)=>{let result;result=session.vm.heap.retentionPath(params.reference,params.options);return result;});
for(const method of ["heap"])handlers.registerHandler(method,(params,method)=>{let result;result=session.vm.heap.inspect(params.limit??200);return result;});
for(const method of ["state"])handlers.registerHandler(method,(params,method)=>{let result;result=session?.state()??null;return result;});
self.onmessage=event=>{
  const id=event.data?.id;
  try{
    const {method,params}=readWorkerRequest(event.data);
    let result;
    handlers.assertMethod(method);
    if(method!=='launch'&&params.sessionId!==undefined&&params.sessionId!==sessionSerial)throw new Error('Debug session changed; retry the command in the current session');
    if(!session&&!['launch','stop','state'].includes(method))throw new Error('Start a debug session first');
    result=activity.dispatch(method,params,handlers.dispatch);
    if(id!==undefined)self.postMessage({id,result});
  }catch(error){if(id!==undefined)self.postMessage({id,error:{message:error.message,name:error.name,code:error.code}});else self.postMessage({event:'error',sessionId:sessionSerial,message:error.message,name:error.name,code:error.code});}
};
