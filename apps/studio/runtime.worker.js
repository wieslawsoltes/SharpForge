import {registerRuntimeLayout} from './runtime-worker-layout.js';
import {createWorkerProtocol,readWorkerRequest} from './workers/protocol.js';
import {applyDesignPatch} from '../../packages/runtime/src/index.js';
import { loadAssembly, equalBytes } from '../../packages/cil/src/index.js';
import {createRuntimeLaunchCandidate} from './workers/runtime-launch.js';
let session=null,timer=null,lastSent=0,uiCommands=[],output=[],loadedModule=null,sessionSerial=0,animationTimer=null,animationLast=0,manualAnimations=false;
function flush(){if(uiCommands.length){self.postMessage({event:'ui',sessionId:sessionSerial,commands:uiCommands});uiCommands=[];}if(output.length){self.postMessage({event:'output',sessionId:sessionSerial,text:output.join('')});output=[];}}
function state(){scheduleAnimations();flush();if(session)self.postMessage({event:'state',sessionId:sessionSerial,...session.state(),assemblyLoad:session.assemblyLoad??null});}
// The UI clock is independent of managed instruction pumping. It freezes at debugger stops.
function scheduleAnimations(){
  const platform=session?.vm.platform,active=!manualAnimations&&session?.vm.state!=='paused'&&platform?.windows?.size>0&&platform?.animations?.running;
  if(!active){if(animationTimer!==null)clearTimeout(animationTimer);animationTimer=null;animationLast=0;return;}
  if(animationTimer!==null)return;const serial=sessionSerial;if(!animationLast)animationLast=performance.now();
  animationTimer=setTimeout(()=>{animationTimer=null;if(!session||serial!==sessionSerial)return;const now=performance.now(),delta=Math.max(0,now-animationLast);animationLast=now;
    if(session.vm.state!=='paused'){try{session.vm.platform.advanceAnimations(delta);flush();schedule();}catch(error){session.vm.platform.animations.clear();self.postMessage({event:'error',sessionId:sessionSerial,message:error.message});}}
    scheduleAnimations();
  },16);
}
function executable(params){
  if(!params.assembly)return {image:params.image,load:null};
  const started=performance.now(),hit=loadedModule&&equalBytes(loadedModule.bytes,params.assembly);
  if(!hit)loadedModule={bytes:params.assembly.slice(),image:loadAssembly(params.assembly)};
  return {image:loadedModule.image,load:{format:'ECMA-335',cacheHit:!!hit,milliseconds:performance.now()-started,bytes:params.assembly.length}};
}
function schedule(){
  if(timer!==null||!session||!['ready','running','waiting'].includes(session.vm.state))return;const serial=sessionSerial;const delay=session.vm.state==='waiting'?session.vm.scheduler.nextDelay():0;if(delay===null)return;
  timer=setTimeout(()=>{
    timer=null;if(!session||serial!==sessionSerial)return;
    try{session.pump({instructionBudget:15000,timeBudgetMs:6});}
    catch(error){session.pause();session.reason={reason:'error',description:error.message};self.postMessage({event:'error',sessionId:sessionSerial,message:error.message});state();return;}
    scheduleAnimations();flush();if(['running','waiting'].includes(session.vm.state)){if(session.vm.state==='waiting'||performance.now()-lastSent>150){lastSent=performance.now();state();}schedule();}else state();
  },Math.min(50,Math.max(0,delay)));
}
function launch(params){
  // Fully construct and bind a candidate first. A malformed replacement must not destroy a live session.
  const {candidate,capabilities}=createRuntimeLaunchCandidate(params,{
    executable,onOutput:text=>output.push(text),
    onUICommand:command=>{uiCommands.push(command);if(uiCommands.length>=1024)flush();}
  });
  if(timer!==null){clearTimeout(timer);timer=null;}session?.stop();session=candidate;sessionSerial++;output=[];uiCommands=[];self.postMessage({event:'ui',sessionId:sessionSerial,commands:[{op:'reset',snapshot:{version:1,windows:[],nodes:[]}}]});lastSent=0;animationLast=0;manualAnimations=!!params.manualAnimations;
  self.postMessage({event:'loaded',sessionId:sessionSerial,sources:(session.vm.image?.sources??session.vm.inspector?.debug?.sources??[]).map(s=>({uri:s.uri,text:s.text}))});
  state();schedule();
  return {started:true,sessionId:sessionSerial,capabilities,profile:params.managedIL?'SharpForge.ManagedIL/1':'SharpForge.CIL',
    sources:(session.vm.image?.sources??session.vm.inspector?.debug?.sources??[]).map(s=>({uri:s.uri,text:s.text,version:s.version}))};
}
const handlers=createWorkerProtocol('runtime');
for(const method of ["launch"])handlers.registerHandler(method,(params,method)=>{let result;result=launch(params);return result;});
for(const method of ["resume"])handlers.registerHandler(method,(params,method)=>{let result;session.resume(params.mode,{granularity:params.granularity});state();schedule();return result;});
for(const method of ["pause"])handlers.registerHandler(method,(params,method)=>{let result;session.pause();state();return result;});
for(const method of ["stop"])handlers.registerHandler(method,(params,method)=>{let result;session?.stop();if(timer!==null){clearTimeout(timer);timer=null;}state();return result;});
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
for(const method of ["hotReload"])handlers.registerHandler(method,(params,method)=>{let result;result=session.applyChanges(params.image??params.assembly,{expectedVersion:params.expectedVersion});self.postMessage({event:'loaded',sessionId:sessionSerial,sources:(session.vm.image?.sources??session.vm.inspector?.debug?.sources??[]).map(s=>({uri:s.uri,text:s.text}))});state();return result;});
for(const method of ["evaluateFunction"])handlers.registerHandler(method,(params,method)=>{let result;result=session.evaluateFunction(params.expression,{...params,allowSideEffects:params.allowSideEffects===true});state();return result;});
for(const method of ["loadSymbols"])handlers.registerHandler(method,(params,method)=>{let result;result=session.loadSymbols(params.pdb??null,params.sources??{});self.postMessage({event:'loaded',sessionId:sessionSerial,sources:(session.vm.inspector?.debug?.sources??[]).map(s=>({uri:s.uri,text:s.text}))});state();return result;});
for(const method of ["symbolInfo"])handlers.registerHandler(method,(params,method)=>{let result;result=session.symbolBinding?{id:session.symbols.idHex,documents:session.symbolBinding.documents.map(({embedded,hash,...d})=>({...d,text:undefined,hash:[...hash]})),methods:session.symbols.methods.length,stateMachines:session.symbols.stateMachines}:null;return result;});
for(const method of ["threads"])handlers.registerHandler(method,(params,method)=>{let result;result=session.threads();return result;});
for(const method of ["parallelStacks"])handlers.registerHandler(method,(params,method)=>{let result;result=session.parallelStacks();return result;});
for(const method of ["stackTrace"])handlers.registerHandler(method,(params,method)=>{let result;result=session.stackTrace(params.threadId);return result;});
for(const method of ["freezeThread"])handlers.registerHandler(method,(params,method)=>{let result;result=session.freezeThread(params.threadId,params.frozen);state();schedule();return result;});
for(const method of ["uiEvent"])handlers.registerHandler(method,(params,method)=>{let result;if(session.vm.state==='paused')throw new Error('Continue execution before interacting with the managed application');result=session.vm.platform.dispatchEvent(params.id,params.event,params.payload);state();schedule();return result;});
for(const method of ["uiAnimationAdvance"])handlers.registerHandler(method,(params,method)=>{let result;if(session.vm.state==='paused')throw new Error('Animation clock is frozen while paused');result=session.vm.platform.advanceAnimations(params.milliseconds);flush();schedule();scheduleAnimations();return result;});
for(const method of ["uiAnimationMode"])handlers.registerHandler(method,(params,method)=>{let result;manualAnimations=!!params.manual;scheduleAnimations();result={manual:manualAnimations};return result;});
for(const method of ["runtimeInfo"])handlers.registerHandler(method,(params,method)=>{let result;result=session.vm.platform.runtimeInfo();return result;});
for(const method of ["uiScene"])handlers.registerHandler(method,(params,method)=>{let result;result=session.vm.platform.scene();return result;});
for(const method of ["designSnapshot"])handlers.registerHandler(method,(params,method)=>{let result;result={scene:session.vm.platform.scene(),revision:session.designRevision??0};return result;});
for(const method of ["applyDesign"])handlers.registerHandler(method,(params,method)=>{let result;result=applyDesignPatch(session,params.patch,{expectedRevision:params.expectedRevision});state();return result;});
registerRuntimeLayout(handlers,{session:()=>session,state,schedule});
for(const method of ["evaluate"])handlers.registerHandler(method,(params,method)=>{let result;result=session.evaluate(params.expression,params.frameId);return result;});
for(const method of ["setVariable"])handlers.registerHandler(method,(params,method)=>{let result;result=session.setVariable(params.frameId,params.name,params.expression);state();return result;});
for(const method of ["locals"])handlers.registerHandler(method,(params,method)=>{let result;result=session.locals(params.frameId);return result;});
for(const method of ["children"])handlers.registerHandler(method,(params,method)=>{let result;result=session.children(params.reference,params.start??0,params.count??100);return result;});
for(const method of ["collect"])handlers.registerHandler(method,(params,method)=>{let result;result=session.collect();state();return result;});
for(const method of ["heapPage"])handlers.registerHandler(method,(params,method)=>{let result;result=session.vm.heap.inspectPage(params);return result;});
for(const method of ["heapCensus"])handlers.registerHandler(method,(params,method)=>{let result;result=session.vm.heap.census();return result;});
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
    result=handlers.dispatch(method,params);
    if(id!==undefined)self.postMessage({id,result});
  }catch(error){if(id!==undefined)self.postMessage({id,error:{message:error.message,name:error.name,code:error.code}});else self.postMessage({event:'error',sessionId:sessionSerial,message:error.message,name:error.name,code:error.code});}
};
