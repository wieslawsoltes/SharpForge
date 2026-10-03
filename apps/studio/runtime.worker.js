import {applyDesignPatch} from '../../packages/runtime/src/index.js';
import { loadAssembly, equalBytes } from '../../packages/cil/src/index.js';
import { DebugSession, CilDebugSession } from '../../packages/debugger/src/index.js';
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
  const debug=params.debug!==false,options={network:params.network??{},compute:params.compute??{},recordHistory:debug&&params.recordHistory!==false,
    maxHistory:params.maxHistory,maxHistoryBytes:params.maxHistoryBytes,stepOverProperties:params.stepOverProperties===true,
    breakpointsEnabled:params.breakpointsEnabled!==false,maxInstructions:params.maxInstructions??20_000_000,onOutput:text=>output.push(text),onUICommand:command=>{uiCommands.push(command);if(uiCommands.length>=1024)flush();}};
  // Fully construct and bind a candidate first. A malformed replacement must not destroy a live session.
  let candidate;
  if(params.managedIL){
    candidate=new CilDebugSession(params.assembly,{...options,methodToken:params.methodToken,arguments:params.arguments,pdb:params.pdb,sources:params.sources});
    candidate.assemblyLoad={format:'ECMA-335',cacheHit:false,milliseconds:candidate.vm.loadMs,bytes:params.assembly.length};
    if(debug)candidate.setInstructionBreakpoints(params.instructionBreakpoints??[]);
  }else{
    const module=executable(params);candidate=new DebugSession(module.image,options);candidate.assemblyLoad=module.load;
  }
  if(debug){for(const [uri,bps]of Object.entries(params.breakpoints??{}))candidate.setBreakpoints(uri,bps);
    candidate.setFunctionBreakpoints(params.functionBreakpoints??[]);
    candidate.setExceptionBreakpoints({mode:params.exceptionBreak??'uncaught',rules:params.exceptionRules??[]});}
  if(params.runToCursor){if(params.managedIL)throw new Error('Use run-to-instruction for managed IL');candidate.runToCursor(params.runToCursor.uri,params.runToCursor.line,params.runToCursor.column);}
  else candidate.start(debug&&params.stopOnEntry===true);
  if(timer!==null){clearTimeout(timer);timer=null;}session?.stop();session=candidate;sessionSerial++;output=[];uiCommands=[];self.postMessage({event:'ui',sessionId:sessionSerial,commands:[{op:'reset',snapshot:{version:1,windows:[],nodes:[]}}]});lastSent=0;animationLast=0;manualAnimations=!!params.manualAnimations;
  self.postMessage({event:'loaded',sessionId:sessionSerial,sources:(session.vm.image?.sources??session.vm.inspector?.debug?.sources??[]).map(s=>({uri:s.uri,text:s.text}))});
  state();schedule();
  return {started:true,sessionId:sessionSerial,profile:params.managedIL?'SharpForge.ManagedIL/1':'SharpForge.CIL',
    sources:(session.vm.image?.sources??session.vm.inspector?.debug?.sources??[]).map(s=>({uri:s.uri,text:s.text,version:s.version}))};
}
self.onmessage=event=>{
  const {id,method,params={}}=event.data;
  try{
    let result;
    if(method!=='launch'&&params.sessionId!==undefined&&params.sessionId!==sessionSerial)throw new Error('Debug session changed; retry the command in the current session');
    if(!session&&!['launch','stop','state'].includes(method))throw new Error('Start a debug session first');
    switch(method){
      case 'launch':result=launch(params);break;
      case 'resume':session.resume(params.mode,{granularity:params.granularity});state();schedule();break;
      case 'pause':session.pause();state();break;
      case 'stop':session?.stop();if(timer!==null){clearTimeout(timer);timer=null;}state();break;
      case 'stepBack':session.stepBack();state();break;
      case 'reverseContinue':session.reverseContinue();state();break;
      case 'dataBreakpointInfo':result=session.dataBreakpointInfo(params);break;
      case 'dataBreakpoints':result=session.setDataBreakpoints(params.breakpoints);state();break;
      case 'breakpoints':result=session.setBreakpoints(params.uri,params.breakpoints);state();break;
      case 'functionBreakpoints':result=session.setFunctionBreakpoints(params.breakpoints);state();break;
      case 'breakpointLocations':result=session.breakpointLocations(params.uri,params);break;
      case 'breakpointsEnabled':result=session.setBreakpointsEnabled(params.enabled);state();break;
      case 'exceptionBreak':result=session.setExceptionBreakpoints({mode:params.mode,rules:params.rules??session.exceptionRules});state();break;
      case 'instructionBreakpoints':result=session.setInstructionBreakpoints(params.breakpoints);state();break;
      case 'runToInstruction':session.runToInstruction(params.reference);state();schedule();break;
      case 'disassemblyMethods':result=session.vm.report.methods.map(token=>{const m=session.vm.inspector.getMethod(token);return {token,name:m.owner+'::'+m.name,count:m.instructions.length};});break;
      case 'runToCursor':result=session.runToCursor(params.uri,params.line,params.column);state();schedule();break;
      case 'disassemble':result=session.disassemble(params.reference,params);break;
      case 'gotoTargets':result=session.gotoTargets(params);break;
      case 'setNextStatement':result=session.setNextStatement(params);state();break;
      case 'hotReload':result=session.applyChanges(params.image??params.assembly,{expectedVersion:params.expectedVersion});self.postMessage({event:'loaded',sessionId:sessionSerial,sources:(session.vm.image?.sources??session.vm.inspector?.debug?.sources??[]).map(s=>({uri:s.uri,text:s.text}))});state();break;
      case 'evaluateFunction':result=session.evaluateFunction(params.expression,{...params,allowSideEffects:params.allowSideEffects===true});state();break;
      case 'loadSymbols':result=session.loadSymbols(params.pdb??null,params.sources??{});self.postMessage({event:'loaded',sessionId:sessionSerial,sources:(session.vm.inspector?.debug?.sources??[]).map(s=>({uri:s.uri,text:s.text}))});state();break;
      case 'symbolInfo':result=session.symbolBinding?{id:session.symbols.idHex,documents:session.symbolBinding.documents.map(({embedded,hash,...d})=>({...d,text:undefined,hash:[...hash]})),methods:session.symbols.methods.length,stateMachines:session.symbols.stateMachines}:null;break;
      case 'threads':result=session.threads();break;
      case 'parallelStacks':result=session.parallelStacks();break;
      case 'stackTrace':result=session.stackTrace(params.threadId);break;
      case 'freezeThread':result=session.freezeThread(params.threadId,params.frozen);state();schedule();break;
      case 'uiEvent':if(session.vm.state==='paused')throw new Error('Continue execution before interacting with the managed application');result=session.vm.platform.dispatchEvent(params.id,params.event,params.payload);state();schedule();break;
      case 'uiAnimationAdvance':if(session.vm.state==='paused')throw new Error('Animation clock is frozen while paused');result=session.vm.platform.advanceAnimations(params.milliseconds);flush();schedule();scheduleAnimations();break;
      case 'uiAnimationMode':manualAnimations=!!params.manual;scheduleAnimations();result={manual:manualAnimations};break;
      case 'runtimeInfo':result=session.vm.platform.runtimeInfo();break;
      case 'uiScene':result=session.vm.platform.scene();break;
      case 'designSnapshot':result={scene:session.vm.platform.scene(),revision:session.designRevision??0};break;
      case 'applyDesign':result=applyDesignPatch(session,params.patch,{expectedRevision:params.expectedRevision});state();break;
      case 'uiLayout':if(session.vm.state==='paused')result=0;else result=session.vm.platform.updateLayout(params.changes);break;
      case 'evaluate':result=session.evaluate(params.expression,params.frameId);break;
      case 'setVariable':result=session.setVariable(params.frameId,params.name,params.expression);state();break;
      case 'locals':result=session.locals(params.frameId);break;
      case 'children':result=session.children(params.reference,params.start??0,params.count??100);break;
      case 'collect':result=session.collect();state();break;
      case 'heapPage':result=session.vm.heap.inspectPage(params);break;
      case 'heapCensus':result=session.vm.heap.census();break;
      case 'retentionPath':result=session.vm.heap.retentionPath(params.reference,params.options);break;
      case 'heap':result=session.vm.heap.inspect(params.limit??200);break;
      case 'state':result=session?.state()??null;break;
      default:throw new Error(`Unknown runtime request '${method}'`);
    }
    if(id!==undefined)self.postMessage({id,result});
  }catch(error){if(id!==undefined)self.postMessage({id,error:{message:error.message,name:error.name}});else self.postMessage({event:'error',sessionId:sessionSerial,message:error.message});}
};
