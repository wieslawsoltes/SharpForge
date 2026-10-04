import { DebugSession, CilDebugSession } from '@sharpforge/debugger';
function launchInput(arguments_) {
  const assembly = arguments_.assembly;
  if (assembly !== undefined) {
    if (assembly instanceof Uint8Array || assembly instanceof ArrayBuffer) { if(assembly.byteLength>64*1024*1024)throw new RangeError('launch.assembly exceeds 64 MiB');return assembly; }
    if (Array.isArray(assembly)) {
      if (assembly.length > 64 * 1024 * 1024 || assembly.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
        throw new TypeError('launch.assembly must contain at most 64 MiB of unsigned bytes');
      }
      return Uint8Array.from(assembly);
    }
    throw new TypeError('launch.assembly must be Uint8Array, ArrayBuffer or a JSON byte array');
  }
  if (arguments_.image) return arguments_.image;
  throw new Error('launch requires assembly bytes or a legacy restored SharpForge image');
}
/** DAP request/response adapter. The host owns scheduling and calls pump() between incoming requests. */
export class DebugAdapter {
  constructor({send=()=>{}}={}){this.send=send;this.seq=0;this.session=null;this.refs=new Map();this.nextRef=1;this.breakpoints=new Map();this.lastState=null;this.exceptionFilters=['uncaught'];this.configured=false;this.lineBase=1;this.columnBase=1;this.instructionBreakpoints=[];this.functionBreakpoints=[];this.launchArguments=null;this.gotoRefs=new Map();this.nextGoto=1;}
  event(event,body={}){this.send({seq:++this.seq,type:'event',event,body});}
  toInternalPosition(a){return {...a,...(a.line!==undefined?{line:a.line+1-this.lineBase}:{}),...(a.column!==undefined?{column:a.column+1-this.columnBase}:{}),...(a.endLine!==undefined?{endLine:a.endLine+1-this.lineBase}:{}),...(a.endColumn!==undefined?{endColumn:a.endColumn+1-this.columnBase}:{})};}
  toClientPosition(a){return {...a,...(a.line!==undefined&&a.line>0?{line:a.line-1+this.lineBase}:{}),...(a.column!==undefined&&a.column>0?{column:a.column-1+this.columnBase}:{}),...(a.endLine!==undefined?{endLine:a.endLine-1+this.lineBase}:{}),...(a.endColumn!==undefined?{endColumn:a.endColumn-1+this.columnBase}:{})};}
  reference(value){const id=this.nextRef++;this.refs.set(id,value);return id;}
  variable(v){return {name:v.name,value:v.value,type:v.type,variablesReference:v.reference?this.reference({kind:'heap',ref:v.reference}):0};}
  async handle(request){const {command,arguments:a={}}=request;let body={};
    try{
      if(['continue','next','stepIn','stepOut','setVariable','dataBreakpointInfo'].includes(command)&&(!this.configured||this.session?.vm.state!=='paused'))throw new Error('A configured, paused debug session is required');
      if(['stackTrace','scopes','variables','evaluate'].includes(command)&&(!this.configured||!['paused','waiting'].includes(this.session?.vm.state)))throw new Error('A paused or suspended debug session is required');
      switch(command){
        case 'initialize':this.lineBase=a.linesStartAt1===false?0:1;this.columnBase=a.columnsStartAt1===false?0:1;body={supportsGotoTargetsRequest:true,supportsBreakpointLocationsRequest:true,supportsLoadedSourcesRequest:true,supportsConfigurationDoneRequest:true,supportsConditionalBreakpoints:true,supportsHitConditionalBreakpoints:true,supportsLogPoints:true,supportsFunctionBreakpoints:true,supportsSetVariable:true,supportsRestartRequest:true,supportsDisassembleRequest:true,supportsInstructionBreakpoints:true,supportsStepBack:true,supportsDataBreakpoints:true,supportsEvaluateForHovers:true,exceptionBreakpointFilters:[{filter:'all',label:'All managed exceptions',default:false},{filter:'uncaught',label:'Uncaught managed exceptions',default:true}]};this.event('initialized');break;
        case 'launch':this.launch(a);break;
        case 'restart':if(!this.launchArguments)throw new Error('No previous launch');this.launch({...this.launchArguments,...a.arguments});this.configured=true;this.session.start(this.stopOnEntry);this.lastState=null;break;
        case 'setInstructionBreakpoints':this.instructionBreakpoints=a.breakpoints??[];body={breakpoints:this.session?.setInstructionBreakpoints?.(this.instructionBreakpoints)??this.instructionBreakpoints.map(b=>({...b,verified:false,message:this.session?'Use a managedIL session for instruction breakpoints':'Pending launch'}))};break;
        case 'disassemble':if(!this.session?.disassemble)throw new Error('Instruction disassembly requires a managedIL launch');body={instructions:this.session.disassemble(a.memoryReference,a)};break;
        case 'configurationDone':if(!this.session)throw new Error('Launch a debug session first');if(this.configured)throw new Error('Debug session is already configured');this.configured=true;this.session.start(this.stopOnEntry);this.lastState=null;break;
        case 'setBreakpoints':{const uri=a.source?.path??a.source?.name;if(typeof uri!=='string'||!uri)throw new Error('Breakpoint source path is required');const bps=(a.breakpoints??[]).map(b=>this.toInternalPosition(b));this.breakpoints.set(uri,bps);body={breakpoints:(this.session?this.session.setBreakpoints(uri,bps):bps.map(b=>({...b,verified:false,message:'Pending launch'}))).map(b=>this.toClientPosition(b))};break;}
        case 'breakpointLocations':if(!this.session)throw new Error('Launch a debug session first');body={breakpoints:this.session.breakpointLocations(a.source?.path??a.source?.name,this.toInternalPosition(a)).map(p=>this.toClientPosition({line:p.line,column:p.column,endLine:p.endLine,endColumn:p.endColumn}))};break;
        case 'loadedSources':body={sources:(this.session?.vm.image?.sources??this.session?.vm.inspector?.debug?.sources??[]).map(s=>({name:s.uri,path:s.uri}))};break;
        case 'setFunctionBreakpoints':this.functionBreakpoints=a.breakpoints??[];body={breakpoints:this.session?.setFunctionBreakpoints(this.functionBreakpoints)??this.functionBreakpoints.map(b=>({...b,verified:false,message:'Pending launch'}))};break;
        case 'setExceptionBreakpoints':this.exceptionFilters=a.filters??[];if(this.session)this.session.exceptionBreak=this.exceptionFilters.includes('all')?'all':this.exceptionFilters.includes('uncaught')?'uncaught':'none';break;
        case 'threads':body={threads:(this.session?.threads()??[]).map(t=>({id:t.id,name:t.name}))};break;
        case 'continue':this.session.resume();this.lastState='running';this.refs.clear();this.event('continued',{threadId:this.session.vm.scheduler.currentId,allThreadsContinued:true});body={allThreadsContinued:true};break;
        case 'next':case 'stepIn':case 'stepOut':this.session.resume(command,{granularity:a.granularity});this.lastState='running';this.refs.clear();this.event('continued',{threadId:this.session.vm.scheduler.currentId,allThreadsContinued:true});break;
        case 'pause':this.session.pause();this.emitState();break;
        case 'stepBack':case 'reverseContinue':if(typeof this.session?.[command]!=='function')throw new Error(command+' is not supported by this session');this.session[command]();this.lastState=null;this.emitState();break;
        case 'dataBreakpointInfo':{if(!this.session?.dataBreakpointInfo){body={dataId:null,description:'Data selection requires a debug session'};break;}const ref=this.refs.get(a.variablesReference);if(!ref)throw new Error('Variable reference has expired');body=this.session.dataBreakpointInfo(ref.kind==='locals'?{frameId:ref.frameId,name:a.name}:ref.kind==='heap'?{reference:ref.ref,name:a.name}:{staticName:a.name});break;}
        case 'setDataBreakpoints':if(!this.session?.dataBreakpointInfo)throw new Error('DAP data breakpoints require a debug session');body={breakpoints:this.session.setDataBreakpoints(a.breakpoints??[])};break;
        case 'stackTrace':{const frames=this.session.stackTrace(a.threadId);body={stackFrames:frames.slice(a.startFrame??0,(a.startFrame??0)+(a.levels??frames.length)).map(f=>this.toClientPosition({...f,source:f.source?{name:f.source,path:f.source}:undefined})),totalFrames:frames.length};break;}
        case 'scopes':body={scopes:[{name:'Locals',presentationHint:'locals',variablesReference:this.reference({kind:'locals',frameId:a.frameId}),expensive:false},{name:'Statics',variablesReference:this.reference({kind:'statics'}),expensive:false}]};break;
        case 'variables':{const ref=this.refs.get(a.variablesReference);if(!ref)throw new Error('Variable reference has expired');let variables=[];
          if(ref.kind==='locals')variables=this.session.locals(ref.frameId);else if(ref.kind==='heap')variables=this.session.children(ref.ref,a.start??0,a.count??100);else variables=this.session.statics?this.session.statics():this.session.vm.image.statics.map((s,i)=>({name:s.name,type:s.type,value:this.session.vm.display(this.session.vm.statics[i]),reference:typeof this.session.vm.statics[i]==='object'?this.session.vm.statics[i]:null}));body={variables:variables.map(v=>this.variable(v))};break;}
        case 'evaluate':{const value=a.context==='repl'&&(a.allowSideEffects===true||this.launchArguments?.allowFunctionEvaluation===true)?this.session.evaluateFunction(a.expression,{frameId:a.frameId,allowSideEffects:true,commit:a.commit!==false}):this.session.evaluate(a.expression,a.frameId);body={result:value.result,type:value.type,variablesReference:value.reference?this.reference({kind:'heap',ref:value.reference}):0};break;}
        case 'gotoTargets':{if(!this.session)throw new Error('Launch first');this.gotoRefs.clear();body={targets:this.session.gotoTargets({...this.toInternalPosition(a),uri:a.source?.path??a.source?.name}).map(target=>{const id=this.nextGoto++;this.gotoRefs.set(id,{...target,expectedInstructions:this.session.vm.instructions,version:this.session.codeVersion??0});return this.toClientPosition({...target,id});})};break;}
        case 'goto':{const target=this.gotoRefs.get(a.targetId);if(!target||target.version!==(this.session?.codeVersion??0))throw new Error('Goto target expired');this.session.setNextStatement(target);this.gotoRefs.clear();this.refs.clear();this.lastState=null;this.emitState();break;}
        case 'sharpforge/parallelStacks':body=this.session.parallelStacks();break;
        case 'sharpforge/freezeThread':body={threads:this.session.freezeThread(a.threadId,a.frozen!==false)};break;
        case 'sharpforge/hotReload':{const input=this.session.vm.image?a.image:launchInput({assembly:a.assembly});body=this.session.applyChanges(input,{expectedVersion:a.expectedVersion});this.refs.clear();this.gotoRefs.clear();this.lastState=null;this.emitState();break;}
        case 'sharpforge/evaluateFunction':{const v=this.session.evaluateFunction(a.expression,a);body={result:v.result,type:v.type,committed:v.committed,variablesReference:v.reference?this.reference({kind:'heap',ref:v.reference}):0};break;}
        case 'sharpforge/loadSymbols':body=this.session.loadSymbols(a.pdb?launchInput({assembly:a.pdb}):null,a.sources??{});this.gotoRefs.clear();this.refs.clear();break;
        case 'sharpforge/uiScene':body=this.session.vm.platform.scene();break;
        case 'sharpforge/uiEvent':if(this.session.vm.state==='paused')throw new Error('Continue before interacting with the application');body={contexts:this.session.vm.platform.dispatchEvent(a.id,a.event,a.payload)};break;
        case 'setVariable':{const ref=this.refs.get(a.variablesReference);if(ref?.kind!=='locals')throw new Error('Only local variable edits are supported');const result=this.session.setVariable(ref.frameId,a.name,a.value);body={value:result.value,type:result.type,variablesReference:0};break;}
        case 'exceptionInfo':{const f=this.session.vm.pendingFault??this.session.vm.fault;if(!f)throw new Error('No active exception');body={exceptionId:f.name,description:f.message,breakMode:this.session.reason?.breakMode==='uncaught'?'unhandled':'always'};break;}
        case 'source':{const source=(this.session.vm.image?.sources??this.session.vm.inspector?.debug?.sources??[]).find(s=>s.uri===(a.source?.path??a.source?.name));if(!source||typeof source.text!=='string')throw new Error('Source text is not embedded for this document');body={content:source.text,mimeType:'text/x-csharp'};break;}
        case 'disconnect':case 'terminate':this.session?.stop();this.event('terminated');break;
        default:throw new Error(`DAP request '${command}' is not implemented`);
      }
      return {seq:++this.seq,type:'response',request_seq:request.seq,command,success:true,body};
    }catch(error){return {seq:++this.seq,type:'response',request_seq:request.seq,command,success:false,message:error.message,body:{}};}
  }
  launch(a){
    const input=launchInput(a),Session=a.managedIL?CilDebugSession:DebugSession;
    const candidate=new Session(input,{methodToken:a.methodToken,arguments:a.arguments,pdb:a.pdb?launchInput({assembly:a.pdb}):null,sources:a.sources??{},virtualTime:a.virtualTime===true,recordHistory:a.recordHistory!==false,stepOverProperties:a.stepOverProperties===true,breakpointsEnabled:a.breakpointsEnabled!==false,maxHistory:a.maxHistory,maxHistoryBytes:a.maxHistoryBytes,maxInstructions:a.maxInstructions??20_000_000,onOutput:text=>this.event('output',{category:'stdout',output:text}),onUICommand:command=>this.event('sharpforge/ui',command)});
    const rebound=[];for(const [uri,bps]of this.breakpoints)rebound.push(...candidate.setBreakpoints(uri,bps));
    candidate.setFunctionBreakpoints(this.functionBreakpoints);candidate.setInstructionBreakpoints?.(this.instructionBreakpoints);
    candidate.exceptionBreak=this.exceptionFilters.includes('all')?'all':this.exceptionFilters.includes('uncaught')?'uncaught':'none';
    this.session?.stop();this.session=candidate;this.launchArguments=structuredClone(a);this.stopOnEntry=a.stopOnEntry===true;this.configured=false;this.lastState=null;this.refs.clear();this.gotoRefs.clear();
    for(const breakpoint of rebound)this.event('breakpoint',{reason:'changed',breakpoint:this.toClientPosition(breakpoint)});
    this.event('capabilities',{capabilities:{supportsStepBack:a.recordHistory!==false,supportsDataBreakpoints:true,supportsDisassembleRequest:!!a.managedIL,supportsInstructionBreakpoints:!!a.managedIL}});
  }
  pump(options){if(!this.session||!this.configured)return;this.session.pump(options);this.emitState();}
  emitState(){const state=this.session.vm.state;if(state===this.lastState)return;this.lastState=state;if(state==='paused'){this.refs.clear();this.event('stopped',{reason:({'instruction breakpoint':'instruction breakpoint','function breakpoint':'function breakpoint','data breakpoint':'data breakpoint',goto:'goto'}[this.session.reason?.reason]??this.session.reason?.reason??'pause'),description:this.session.reason?.description,hitBreakpointIds:this.session.reason?.hitBreakpointIds??(this.session.reason?.breakpointId?[this.session.reason.breakpointId]:undefined),threadId:this.session.vm.scheduler.currentId,allThreadsStopped:true});}else if((state==='terminated'&&!this.session.vm.platform.windows.size)||state==='faulted'){if(state==='faulted')this.event('output',{category:'stderr',output:this.session.vm.fault?.message+'\n'});this.event('exited',{exitCode:state==='faulted'?(this.session.vm.exitCode||1):this.session.vm.exitCode});this.event('terminated');}}
}
