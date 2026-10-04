import {contextFrames,threads,parallelStacks,freezeThread,prepareStepOut,stepOutTarget} from './concurrency.js';
import {setNextStatement,gotoTargets,hotReload,evaluateFunction,loadPortableSymbols,releaseEvaluationHandles} from './advanced.js';
import { CilVirtualMachine, isReference, ManagedFault, deoptWasmFrames } from '@sharpforge/runtime';
import { selectMethod, ilLabel, tokenHex } from '@sharpforge/cil';
import {SourceBreakpointIndex} from './source-locations.js';
import {sameBreakpointRule,validateBreakpointRule,evaluateBreakpointRule,formatLogpoint,ruleState,restoreRuleState,publicBreakpoint} from './breakpoint-rules.js';
import {readDebugDirectory} from '@sharpforge/symbols';
import { parseExpression } from '@sharpforge/syntax';
import {pumpCilSession, pauseCilSession} from './cil-execution-control.js';

const address = (token, offset) => `il:${token.toString(16).padStart(8, '0')}:${offset.toString(16).padStart(8, '0')}`;
const primitive = new Set(['int','uint','long','ulong','short','ushort','byte','sbyte','bool','char','float','double','nint','nuint']);
const hitPattern = /^(?:>=|==|%)?\s*[1-9]\d*$/;

/** Instruction-level debugger for the explicitly verified managed-IL subset.
 * Assemblies do not need #SF metadata. Portable PDBs are loaded explicitly or from embedded debug data; this is not native CLR attachment.
 * Inspection and watch evaluation never call getters or execute target methods.
 */
export class CilDebugSession {
  threads(){return threads(this);}
  parallelStacks(){return parallelStacks(this);}
  freezeThread(id,frozen=true){return freezeThread(this,id,frozen);}
  setNextStatement(target){return setNextStatement(this,target);}
  gotoTargets(target){return gotoTargets(this,target);}
  applyChanges(input,options){return hotReload(this,input,options);}
  evaluateFunction(expression,options){return evaluateFunction(this,expression,options);}
  loadSymbols(pdb,sources){return loadPortableSymbols(this,pdb,sources);}
  constructor(bytes, options = {}) {
    this.vm = new CilVirtualMachine(bytes, options);
    this.options = options;this.breakpointsEnabled=options.breakpointsEnabled!==false;this.exceptionRules=[];
    this.sourceIndex=new SourceBreakpointIndex({...this.vm.inspector.debug,sequencePoints:(this.vm.inspector.debug?.sequencePoints??[]).filter(p=>this.vm.report.methods.includes(p.methodToken))});
    this.functionOffsets=new Map();for(const p of this.sourceIndex.byId.values())if(!this.functionOffsets.has(p.methodToken)||p.ilOffset<this.functionOffsets.get(p.methodToken))this.functionOffsets.set(p.methodToken,p.ilOffset);
    this.recordHistory=options.recordHistory??false;this.history=[];this.historyBytes=0;this.historyDropped=0;
    this.maxHistory=options.maxHistory??128;this.maxHistoryBytes=options.maxHistoryBytes??8*1024*1024;
    if(!Number.isSafeInteger(this.maxHistory)||this.maxHistory<0||this.maxHistory>10000||!Number.isSafeInteger(this.maxHistoryBytes)||this.maxHistoryBytes<0||this.maxHistoryBytes>256*1024*1024)throw new RangeError('Invalid bounded IL history budget');
    this.dataBreakpoints=[];this.stoppedBeforeInstruction=false;
    this.vm.onWrite=write=>this.written(write);
    this.breakpoints = [];
    this.functionBreakpoints = [];this.instructionIndex=new Map();this.functionIndex=new Map();
    this.breakpointId = 0;
    this.mode = 'continue';
    this.reason = null;
    this.exceptionBreak = 'none';
    this.skipOnce = null;
    this.temporary = null;
    this.expressionCache = new Map();
    this.vm.onException = fault => {
      const rule=this.exceptionRules.find(r=>r.name.replace(/^System\./,'')===fault.name.replace(/^System\./,'')),mode=rule?.mode??this.exceptionBreak;
      if (mode === 'all' || mode === 'uncaught' && !this.willCatch(fault)) {
        deoptWasmFrames(this.vm);
        this.temporary=null;this.stoppedBeforeInstruction=false;this.reason = {reason:'exception',phase:'after',breakMode:mode, description:`${fault.name}: ${fault.message}`};
        return true;
      }
      return false;
    };
    if(options.pdb||options.autoLoadSymbols!==false&&readDebugDirectory(this.vm.inspector.pe.bytes).some(e=>e.kind===17))this.loadSymbols(options.pdb??null,options.sources??{});
  }
  willCatch(fault) {
    if(this.vm.scheduler.current?.task)return true;return this.vm.frames.some(frame => frame.method.handlers.some(h => h.flags === 0 &&
      frame.lastOffset >= h.start && frame.lastOffset < h.end &&
      (['System.Exception','System.Object'].includes(this.vm.inspector.metadata.typeName(h.catchType)) ||
       fault.reference && this.vm.matches(fault.reference, this.vm.inspector.metadata.typeName(h.catchType)) ||
       this.vm.inspector.metadata.typeName(h.catchType).replace(/^System\./,'') === fault.name.replace(/^System\./,''))));
  }
  frame(id) {
    const frame = id === undefined ? this.vm.top : this.vm.allFrames().find(f => f.id === id);
    if (!frame) throw new Error('Stack frame no longer exists');
    return frame;
  }
  location(reference, offset = 0) {
    const match = typeof reference === 'string' && /^il:([0-9a-f]{8}):([0-9a-f]{8})$/i.exec(reference);
    if (!match || !Number.isSafeInteger(offset)) throw new Error('Expected an il:MethodDefToken:offset instruction reference');
    const token = parseInt(match[1],16), at = parseInt(match[2],16) + offset;
    const method = this.vm.inspector.getMethod(token);
    if (!Number.isSafeInteger(at) || !method.instructions.some(i => i.offset === at)) throw new Error('Address is not an IL instruction boundary');
    return {token,offset:at,method};
  }
  setBreakpointsEnabled(enabled){if(typeof enabled!=='boolean')throw new TypeError('Breakpoint enable switch must be Boolean');this.breakpointsEnabled=enabled;return enabled;}
  setExceptionBreakpoints({mode='uncaught',rules=[]}={}){
    if(!['none','all','uncaught'].includes(mode)||!Array.isArray(rules)||rules.length>256||rules.some(r=>typeof r.name!=='string'||!r.name||r.name.length>256||!['none','all','uncaught'].includes(r.mode)))throw new Error('Invalid exception settings');
    this.exceptionBreak=mode;this.exceptionRules=rules.map(r=>({name:r.name,mode:r.mode}));return {mode,rules:this.exceptionRules};
  }
  breakpointLocations(uri,range){return this.sourceIndex.locations(uri,range);}
  setInstructionBreakpoints(requests) {
    if (!Array.isArray(requests) || requests.length > 10000) throw new RangeError('At most 10000 instruction breakpoints are supported');
    const previous=this.breakpoints.filter(b=>!b.source),used=new Set();
    const result=requests.map(request=>{
      const bp={...request,id:++this.breakpointId,hits:0,enabled:request.enabled!==false,verified:false};
      delete bp.source;delete bp.locations;delete bp.conditionValue;delete bp.conditionSeeded;
      try{
        const ref=request.instructionReference??address(Number(request.methodToken),Number(request.ilOffset??0));
        const p=this.location(ref,request.offset??0);
        if(!this.vm.report.methods.includes(p.token))throw new Error('Method is outside this invocation’s verified call graph');
        Object.assign(bp,{methodToken:p.token,ilOffset:p.offset,instructionReference:address(p.token,p.offset)});
        const old=previous.find(b=>!used.has(b.id)&&b.instructionReference===bp.instructionReference);
        if(old){used.add(old.id);bp.id=old.id;if(sameBreakpointRule(old,bp)){bp.hits=old.hits;bp.conditionSeeded=old.conditionSeeded;bp.conditionValue=old.conditionValue;}}
        validateBreakpointRule(request,text=>this.parse(text));bp.verified=true;
      }catch(error){bp.message=error.message;}
      return bp;
    });
    this.breakpoints=[...this.breakpoints.filter(b=>b.source),...result];this.reindexBreakpoints();return result.map(publicBreakpoint);
  }
  setBreakpoints(uri, requests) {
    if(typeof uri!=='string'||!uri||!Array.isArray(requests)||requests.length>10000)throw new TypeError('Invalid source breakpoint request');
    const previous=this.breakpoints.filter(b=>b.source===uri),used=new Set();
    const result=requests.map(request=>{
      const {point:p,locations,message}=this.sourceIndex.resolve(uri,request);
      const old=previous.find(b=>!used.has(b.id)&&b.requestedLine===request.line&&(b.requestedColumn??null)===(request.column??null));if(old)used.add(old.id);
      const same=sameBreakpointRule(old,request),bp={...request,id:old?.id??++this.breakpointId,source:uri,uri,hits:same?old?.hits??0:0,
        enabled:request.enabled!==false,verified:!!p,requestedLine:request.line,requestedColumn:request.column,
        methodToken:p?.methodToken,ilOffset:p?.ilOffset,line:p?.line??request.line,column:p?.column,endLine:p?.endLine,endColumn:p?.endColumn,locations:locations??[]};
      delete bp.conditionValue;delete bp.conditionSeeded;if(message)bp.message=message;
      if(same&&old){bp.conditionValue=old.conditionValue;bp.conditionSeeded=old.conditionSeeded;}
      try{validateBreakpointRule(request,text=>this.parse(text));}catch(error){bp.verified=false;bp.message=error.message;}
      return bp;
    });this.breakpoints=[...this.breakpoints.filter(b=>b.source!==uri),...result];this.reindexBreakpoints();return result.map(publicBreakpoint);
  }
  setFunctionBreakpoints(requests) {
    if(!Array.isArray(requests)||requests.length>10000)throw new RangeError('Invalid function breakpoints');
    const previous=this.functionBreakpoints,used=new Set();
    this.functionBreakpoints=requests.map(value=>{
      const request=typeof value==='string'?{name:value}:value,old=previous.find(b=>!used.has(b.id)&&b.name===request?.name);if(old)used.add(old.id);
      const same=sameBreakpointRule(old,request),b={...request,id:old?.id??++this.breakpointId,enabled:request?.enabled!==false,hits:same?old?.hits??0:0,verified:false,methodTokens:[]};
      try{
        if(typeof b.name!=='string'||b.name.length>1024)throw new Error('Function name is required');
        const parsed=/^(.+?)(?:\(([^()]*)\))?$/.exec(b.name.trim().replaceAll('::','.'));if(!parsed)throw new Error('Invalid function name');
        const signature=parsed[2]===undefined?null:parsed[2].split(',').map(s=>s.trim()).filter(Boolean);
        b.methodTokens=this.vm.report.methods.filter(token=>{const m=this.vm.inspector.getMethod(token);return (m.name===parsed[1]||m.owner+'.'+m.name===parsed[1])&&(!signature||signature.length===m.signature.parameters.length&&signature.every((t,i)=>t===m.signature.parameters[i]));});
        b.methodToken=b.methodTokens[0];if(!b.methodTokens.length)throw new Error('No matching function in the verified call graph');
        validateBreakpointRule(request,text=>this.parse(text));b.verified=true;
        if(same&&old){b.conditionValue=old.conditionValue;b.conditionSeeded=old.conditionSeeded;}
      }catch(error){b.message=error.message;}return b;
    });this.reindexBreakpoints();return this.functionBreakpoints.map(publicBreakpoint);
  }
  reindexBreakpoints(){this.instructionIndex.clear();this.functionIndex.clear();for(const b of this.breakpoints){if(!b.verified)continue;for(const p of b.source?b.locations:[b]){const key=p.methodToken+':'+p.ilOffset;if(!this.instructionIndex.has(key))this.instructionIndex.set(key,[]);this.instructionIndex.get(key).push(b);}}for(const b of this.functionBreakpoints)for(const token of b.methodTokens??[]){if(!this.functionIndex.has(token))this.functionIndex.set(token,[]);this.functionIndex.get(token).push(b);}}
  matchesHit(bp) {
    if (!bp.hitCondition) return true;
    const s=String(bp.hitCondition).trim(),n=Number(s.replace(/^[^\d]+/,''));
    return s.startsWith('>=') ? bp.hits>=n : s.startsWith('%') ? bp.hits%n===0 : bp.hits===n;
  }
  testCandidates(candidates,frame,kind){
    if(!this.breakpointsEnabled)return [];
    const stops=[];
    for(const bp of candidates){
      if(bp.enabled===false||bp.verified===false)continue;
      try{if(!evaluateBreakpointRule(bp,text=>this.evaluate(text,frame.id),this.vm))continue;}
      catch(error){stops.push({bp,kind,error:error.message});continue;}
      if(bp.oneShot){bp.enabled=false;bp.consumed=true;}
      if(bp.logMessage){this.vm.emitOutput(formatLogpoint(bp.logMessage,text=>this.evaluate(text,frame.id),v=>this.vm.format(v))+'\n');continue;}
      stops.push({bp,kind});
    }return stops;
  }
  instruction(instruction, frame) {
    this.remember();
    const skip=this.skipOnce===frame.id+':'+frame.pc;this.skipOnce=null;if(skip)return false;
    const entry=instruction.offset===(this.functionOffsets.get(frame.method.token)??0)&&!frame.debugEntryVisited;if(entry)frame.debugEntryVisited=true;
    const candidates=this.instructionIndex.get(frame.method.token+':'+instruction.offset)??[];
    const hits=[...candidates.flatMap(bp=>this.testCandidates([bp],frame,bp.source?'breakpoint':'instruction breakpoint')),
      ...this.testCandidates(entry?this.functionIndex.get(frame.method.token)??[]:[],frame,'function breakpoint')];
    if(hits.length){const hit=hits[0];this.temporary=null;this.reason={reason:hit.kind,phase:'before',breakpointId:hit.bp.id,hitBreakpointIds:hits.map(h=>h.bp.id),
      description:hit.error?'Breakpoint condition failed: '+hit.error:`${tokenHex(frame.method.token)} ${instruction.label}; instruction has not executed`};return true;}
    if(this.temporary?.methodToken===frame.method.token&&this.temporary.ilOffset===instruction.offset&&(this.temporary.frameId===undefined||this.temporary.frameId===frame.id)){
      this.temporary=null;this.reason={reason:'goto',phase:'before',description:'Run to instruction'};return true;
    }
    const advanced=this.vm.instructions>this.startInstructions;const visible=this.sourceIndex.byMethod.get(frame.method.id)?.find(p=>p.ilOffset===instruction.offset);const sourceBoundary=!this.sourceStepping||!!visible&&(this.mode==='entry'||frame.id!==this.startFrameId||visible.id!==this.startPointId);
    if(sourceBoundary&&(this.mode==='entry'||advanced&&(this.mode==='stepIn'||this.mode==='next'&&this.vm.scheduler.currentId===this.startContextId&&this.vm.frames.length<=this.startDepth||this.mode==='stepOut'&&stepOutTarget(this)))){
      this.reason={reason:this.mode==='entry'?'entry':'step',phase:'before',description:this.mode==='entry'?'Break on IL entry; no breakpoint was hit':this.sourceStepping?'Next verified source statement':'Next IL instruction'};return true;
    }
    if(instruction.name==='break'){this.temporary=null;this.reason={reason:'pause',phase:'before',description:'MSIL break instruction'};return true;}
    return false;
  }
  resume(mode='continue',options={}) {
    releaseEvaluationHandles(this);
    if(!['continue','entry','stepIn','next','stepOut'].includes(mode))throw new Error('Unknown stepping mode');
    if(['terminated','faulted'].includes(this.vm.state))return;if(this.vm.state==='running')throw new Error('Execution is already running');if(mode!=='continue')this.temporary=null;
    if(this.vm.state==='paused'&&this.stoppedBeforeInstruction&&this.vm.top)this.skipOnce=this.vm.top.id+':'+this.vm.top.pc;
    this.sourceStepping=options.granularity!=='instruction'&&(this.symbols||this.vm.scheduler.current?.kind==='async')&&this.sourceIndex.byId.size>0;this.startFrameId=this.vm.top?.id;this.startPointId=this.vm.top?this.stackTrace().find(f=>f.id===this.vm.top.id)?.point?.id:null;prepareStepOut(this);this.startContextId=this.vm.scheduler.currentId;this.mode=mode;this.startDepth=this.vm.frames.length;this.startInstructions=this.vm.instructions;this.reason=null;this.stoppedBeforeInstruction=false;this.vm.state=this.vm.scheduler.parked?'waiting':'running';
  }
  start(stopOnEntry=true){this.resume(stopOnEntry?'entry':'continue');return this;}
  pump(options={}){return pumpCilSession(this,options);}
  rememberStop(){if(this.vm.state!=='paused'||!this.reason||this.reason.phase==='before')return;this.remember();const last=this.history.at(-1);if(last?.snapshot.instructions===this.vm.instructions&&last.snapshot.writeRevision===this.vm.writeRevision){last.stop={...this.reason};last.stoppedRules=[...this.breakpoints,...this.functionBreakpoints,...this.dataBreakpoints].map(ruleState);}}
  runUntilStop(){while(this.vm.state==='running'||this.vm.state==='ready')this.pump({instructionBudget:50000,timeBudgetMs:50});return this.state();}
  pause(){pauseCilSession(this);}
  stop(){this.vm.stop();this.temporary=null;this.reason={reason:'terminated'};}
  /** Opt-in full-state instruction history. Budgets account conservatively for JS containers. */
  syncHostHistory(){const host=this.vm.platform.hostOperations;if(this.hostHistoryRevision!==host.revision){this.historyDropped+=this.history.length;this.history=[];this.historyBytes=0;this.hostHistoryRevision=host.revision;}return host.active.size===0;}
  remember(force=false){
    if(!this.syncHostHistory())return;
    if(!this.recordHistory||!this.maxHistory||!this.maxHistoryBytes)return;
    const vm=this.vm,last=this.history.at(-1);
    if(!force&&last?.snapshot.instructions===vm.instructions&&last.snapshot.writeRevision===vm.writeRevision&&last.snapshot.heapRevision===vm.heap.mutationRevision)return;
    const bytes=1024+vm.heap.stats.liveBytes*3+vm.heap.records.length*32+vm.heap.handles.size*96+
      vm.frames.reduce((n,f)=>n+512+(f.args.length+f.locals.length+f.stack.length)*24+f.unwinds.length*256,0)+
      vm.outputCharacters*2+vm.output.length*16+(vm.statics.size+vm.strings.size+vm.initialized.size)*96+(this.breakpoints.length+this.dataBreakpoints.length)*96;
    if(bytes>this.maxHistoryBytes){this.historyDropped++;return;}
    while(this.history.length>=this.maxHistory||this.history.length&&this.historyBytes+bytes>this.maxHistoryBytes){this.historyBytes-=this.history.shift().bytes;this.historyDropped++;}
    this.history.push({snapshot:vm.snapshot(),bytes,beforeInstruction:vm.state==='running'||this.stoppedBeforeInstruction,rules:[...this.breakpoints,...this.functionBreakpoints,...this.dataBreakpoints].map(ruleState),hits:new Map([...this.breakpoints,...this.dataBreakpoints].map(b=>[b.id,b.hits??0]))});this.historyBytes+=bytes;
  }
  collect(){if(this.vm.state==='running')throw new Error('Pause execution before collecting through the debugger');this.remember(true);return this.vm.heap.collect();}
  popHistory(){
    while(this.history.length){const item=this.history.pop();this.historyBytes-=item.bytes;
      if(item.snapshot.instructions===this.vm.instructions&&item.snapshot.writeRevision===this.vm.writeRevision&&item.snapshot.heapRevision===this.vm.heap.mutationRevision)continue;
      return item;
    }
    return null;
  }
  restoreHistory(item,stopped=false){
    this.vm.restore(item.snapshot);this.vm.state='paused';deoptWasmFrames(this.vm);this.mode='continue';this.skipOnce=null;this.temporary=null;
    this.stoppedBeforeInstruction=item.beforeInstruction!==false;
    for(const bp of [...this.breakpoints,...this.functionBreakpoints,...this.dataBreakpoints])restoreRuleState(bp,(stopped?item.stoppedRules??item.rules:item.rules)?.find(r=>r.id===bp.id));
    this.reason={reason:'step',description:'Restored the previous retained IL state'};
  }
  stepBack(){this.syncHostHistory();
    if(this.vm.state==='running')throw new Error('Pause before reversing execution');
    if(!this.recordHistory)throw new Error('Reverse IL history was not enabled for this session');
    const item=this.popHistory();if(!item)throw new Error('No earlier retained IL state');
    this.restoreHistory(item);return this.state();
  }
  reverseContinue(){this.syncHostHistory();
    if(this.vm.state==='running')throw new Error('Pause before reversing execution');
    if(!this.recordHistory)throw new Error('Reverse IL history was not enabled for this session');
    let item,restored=false;
    while((item=this.popHistory())){
      this.restoreHistory(item,!!item.stop);restored=true;
      if(item.stop&&['entry','exception','data breakpoint','breakpoint','instruction breakpoint','function breakpoint','goto'].includes(item.stop.reason)){
        this.reason={...item.stop,reverse:true,description:'Reverse continue: '+item.stop.description};return this.state();
      }
    }
    if(!restored)throw new Error('No earlier retained IL state');
    this.reason={reason:'step',phase:'before',description:'Reached the beginning of retained IL history'};return this.state();
  }
  reverseCondition(condition,frameId){try{const result=this.evaluate(condition,frameId);return result.type==='bool'&&!!result.value;}catch{return false;}}
  dataBreakpointInfo({frameId,name,reference,staticName}={}){
    let location;
    if(reference){
      const record=this.vm.heap.get(reference);let index;
      if(record.kind==='array'){const match=/^\[?(\d+)\]?$/.exec(String(name));index=match?Number(match[1]):-1;}
      else if(record.kind==='box')index=name==='value'||name==='[0]'?0:-1;
      else if(record.kind==='object')index=this.vm.layout(this.vm.typeOf(reference)).fields.findIndex(f=>f.name===name);
      if(index>=0&&index<record.data.length)location={kind:record.kind==='object'?'field':record.kind,handle:reference.h,generation:reference.g,index};
    }else if(staticName!==undefined){const f=[...this.vm.inspector.fields.values()].find(f=>f.isStatic&&(f.name===staticName||f.owner+'.'+f.name===staticName));if(f)location={kind:'static',index:f.token};}
    else {const frame=this.frame(frameId),slot=this.slots(frame).find(v=>v.name===name||v.aliases.includes(name));if(slot)location={kind:slot.kind,index:slot.index,frameId:frame.id};}
    return location?{dataId:'cil-data:'+encodeURIComponent(JSON.stringify(location)),description:String(name??staticName),accessTypes:['write'],canPersist:false}:
      {dataId:null,description:'No writable managed storage for this selection',accessTypes:[],canPersist:false};
  }
  setDataBreakpoints(requests){
    if(!Array.isArray(requests)||requests.length>10000)throw new RangeError('At most 10000 data breakpoints are supported');
    const previous=this.dataBreakpoints;this.dataBreakpoints=requests.map(request=>{
      const bp={id:++this.breakpointId,hits:0,verified:false,enabled:request.enabled!==false};
      try{
        if(request.accessType&&request.accessType!=='write')throw new Error('Only write data breakpoints are supported');
        let location=request;
        if(request.dataId!==undefined){if(typeof request.dataId!=='string'||request.dataId.length>4096||!request.dataId.startsWith('cil-data:'))throw new Error('Invalid data breakpoint ID');location=JSON.parse(decodeURIComponent(request.dataId.slice(9)));}
        bp.kind=location.kind;bp.index=location.index;
        if(!Number.isInteger(bp.index)||bp.index<0)throw new Error('Invalid storage index');
        if(['field','array','box'].includes(bp.kind)){
          bp.handle=location.handle;bp.generation=location.generation;const r=this.vm.heap.get({h:bp.handle,g:bp.generation});
          if(r.kind!==(bp.kind==='field'?'object':bp.kind)||bp.index>=r.data.length)throw new Error('Invalid managed heap storage');
        }else if(['arg','local'].includes(bp.kind)){
          bp.frameId=location.frameId??this.vm.top?.id;const frame=this.frame(bp.frameId);
          if(bp.index>=(bp.kind==='arg'?frame.args:frame.locals).length)throw new Error('Invalid frame storage');
        }else if(bp.kind==='static'){if(!this.vm.statics.has(bp.index))throw new Error('Invalid static field token');}
        else throw new Error('Unsupported storage kind');
        for(const k of ['condition','conditionMode','hitCondition','logMessage','oneShot','dataId'])if(request[k]!==undefined)bp[k]=request[k];validateBreakpointRule(bp,text=>this.parse(text));
        if(request.hitCondition){if(!hitPattern.test(String(request.hitCondition)))throw new Error('Invalid hit condition');bp.hitCondition=String(request.hitCondition);}
        const old=previous.find(p=>['kind','index','frameId','handle','generation'].every(k=>p[k]===bp[k]));if(old){bp.id=old.id;if(sameBreakpointRule(old,bp)){bp.hits=old.hits;bp.conditionSeeded=old.conditionSeeded;bp.conditionValue=old.conditionValue;}}bp.verified=true;
      }catch(error){bp.message=error.message;}return bp;
    });return this.dataBreakpoints.map(b=>({...b}));
  }
  written(write){
    const candidates=this.dataBreakpoints.filter(b=>['kind','index','frameId','handle','generation'].every(k=>b[k]===undefined||b[k]===write[k]));
    const hits=this.testCandidates(candidates,this.vm.top,'data breakpoint');
    if(hits.length){this.temporary=null;this.reason={reason:'data breakpoint',phase:'after',breakpointId:hits[0].bp.id,hitBreakpointIds:hits.map(h=>h.bp.id),
      description:hits[0].error?'Data breakpoint condition failed: '+hits[0].error:'Watched storage was written; the highlighted instruction has executed',
      write:{...write,oldDisplay:write.oldValue===undefined?'<unassigned>':this.vm.display(write.oldValue),newDisplay:this.vm.display(write.value)}};
      this.vm.state='paused';deoptWasmFrames(this.vm);this.stoppedBeforeInstruction=false;}
  }
  runToInstruction(reference){const p=this.location(reference);if(!this.vm.report.methods.includes(p.token))throw new Error('Target is outside the verified call graph');this.temporary={methodToken:p.token,ilOffset:p.offset,...(this.vm.top?.method.token===p.token?{frameId:this.vm.top.id}:{})};this.resume();}
  stackTrace(threadId){return [...contextFrames(this,threadId)].reverse().map(frame=>{
    const isCurrent=frame===this.vm.top,before=isCurrent&&(this.vm.state!=='paused'||this.stoppedBeforeInstruction);
    const instruction=before?frame.method.instructions[frame.pc]:frame.method.instructions.find(i=>i.offset===frame.lastOffset);
    const offset=instruction?.offset??frame.lastOffset;
    const points=this.sourceIndex.byMethod.get(frame.method.id)??[];
    const point=[...points].reverse().find(p=>p.ilOffset<=offset);
    return {id:frame.id,name:frame.method.owner+'::'+frame.method.name,methodToken:frame.method.token,ilOffset:offset,
      instructionPointerReference:address(frame.method.token,offset),pc:frame.pc,isCurrent,point:point&&(!this.symbols||this.symbols.location(frame.method.token,offset))?{...point}:null,
      source:point&&(!this.symbols||this.symbols.location(frame.method.token,offset))?point.uri:null,line:point?.line??0,column:point?.column??0,endLine:point?.endLine,endColumn:point?.endColumn};
  });}
  variable(name,type,value,extra={}) {
    return {name,type,value:value===undefined?'<unassigned>':value?.byref?`&${value.kind}[${value.index}]`:this.vm.display(value),raw:value,
      reference:isReference(value)?value:null,...extra};
  }
  slots(frame){
    const m=frame.method,debug=this.vm.inspector.debug?.methods?.find(d=>d.token===m.token),names=debug?.locals??[];
    const args=frame.args.map((value,index)=>{const sequence=index+(m.signature.isStatic?1:0),name=sequence===0?'this':m.parameters.find(p=>p.sequence===sequence)?.name||'arg'+index;
      return this.variable(name,this.vm.slotType(frame,true,index),value,{kind:'arg',index,aliases:['arg'+index]});});
    const at=frame===this.vm.top&&this.stoppedBeforeInstruction?(m.instructions[frame.pc]?.offset??frame.lastOffset):frame.lastOffset;
    const active=this.symbols?.locals(m.token,at),byIndex=active?new Map(active.map(v=>[v.index,v])):null;
    const locals=frame.locals.flatMap((value,index)=>byIndex&&!byIndex.has(index)?[]:[this.variable(byIndex?.get(index)?.name??names[index]?.name??'V_'+index,m.locals[index],value,{kind:'local',index,aliases:['V_'+index,'local'+index]})]);
    const constants=(this.symbols?.scopes??[]).filter(s=>s.methodToken===m.token&&at>=s.start&&at<s.end).flatMap(s=>s.constants).filter(c=>c.decoded).map(c=>this.variable(c.name,c.type,c.value,{kind:'constant',readOnly:true,aliases:[]}));
    return [...args,...locals,...constants];
  }
  locals(frameId){return this.slots(this.frame(frameId));}
  statics(){return [...this.vm.inspector.fields.values()].filter(f=>f.isStatic).map(f=>this.variable(f.owner+'::'+f.name,this.vm.inspector.signature(f.token).type,this.vm.statics.get(f.token),{token:f.token}));}
  children(reference,start=0,count=100){
    if(!Number.isInteger(start)||start<0||!Number.isInteger(count)||count<1||count>1000)throw new RangeError('Invalid object inspection page');
    const record=this.vm.heap.get(reference);if(record.kind==='string')return [this.variable('Length','int',record.data.length)];
    const td=this.vm.inspector.types.find(t=>t.name===record.type),fields=td?this.vm.layout(td.token).fields:[];
    return record.data.slice(start,start+count).map((value,i)=>this.variable(record.kind==='array'?`[${start+i}]`:fields[start+i]?.name??(record.kind==='exception'?'Message':`Field ${start+i}`),fields[start+i]?.type??(record.kind==='array'?record.type.slice(0,-2):'object'),value));
  }
  parse(text){
    if(typeof text!=='string'||text.length>16384)throw new RangeError('Watch expression exceeds 16384 characters');
    if(this.expressionCache.has(text))return this.expressionCache.get(text);
    const p=parseExpression(text);if(p.diagnostics.length)throw new Error(p.diagnostics[0].message);
    if(this.expressionCache.size>=256)this.expressionCache.delete(this.expressionCache.keys().next().value);
    this.expressionCache.set(text,p.expression);return p.expression;
  }
  evaluate(expression,frameId){
    const frame=this.frame(frameId);let budget=1000,checked=false;
    const value=(v,type)=>({value:v,type:type??(v===null?'null':isReference(v)?this.vm.heap.get(v).type:v?.float?'double':typeof v==='bigint'?'long':typeof v==='boolean'?'bool':typeof v==='string'?'string':'int')});
    const truth=v=>{if(v.type!=='bool')throw new Error('Boolean expression required');return !!v.value;};
    const walk=node=>{
      if(--budget<0)throw new Error('Watch evaluation budget exceeded');
      switch(node.kind){
        case 'Literal':return value(node.value,node.type);
        case 'Checked':case 'Unchecked':{const saved=checked;checked=node.kind==='Checked';try{return walk(node.expression);}finally{checked=saved;}}
        case 'Default':return value(node.type==='bool'?false:primitive.has(node.type)?0:null,node.type);
        case 'Name':{const slot=this.slots(frame).find(s=>s.name===node.name||s.aliases.includes(node.name));if(!slot)throw new Error(`Unknown variable '${node.name}'`);if(slot.raw===undefined)throw new Error('Variable is unassigned');return value(slot.type==='bool'?!!slot.raw:slot.raw,slot.type);}
        case 'Cast':{const v=walk(node.expression);if(!primitive.has(v.type)||v.type==='bool'||!['int','double'].includes(node.type))throw new Error('Only int/double numeric watch casts are supported');return value(this.vm.convert(node.type==='int'?(checked?'conv.ovf.i4':'conv.i4'):'conv.r8',v.type==='double'&&typeof v.value==='number'?{float:'r8',value:v.value}:v.value),node.type);}
        case 'Index':{const object=walk(node.target),index=walk(node.index);if(index.type!=='int')throw new Error('Index must be int');const record=this.vm.indexed(object.value,index.value);return value(record.data[index.value],record.type.slice(0,-2));}
        case 'Member':{
          if(node.target.kind==='Name'&&!this.slots(frame).some(s=>s.name===node.target.name||s.aliases.includes(node.target.name))){const f=[...this.vm.inspector.fields.values()].find(f=>f.isStatic&&f.owner===node.target.name&&f.name===node.name);if(f)return value(this.vm.statics.get(f.token),this.vm.inspector.signature(f.token).type);}
          const object=walk(node.target),record=this.vm.heap.get(object.value);
          if(node.name==='Length'&&['array','string'].includes(record.kind))return value(record.data.length,'int');
          const td=this.vm.inspector.types.find(t=>t.name===record.type),fields=td?this.vm.layout(td.token).fields:[],index=fields.findIndex(f=>f.name===node.name||f.name===`<${node.name}>k__BackingField`);
          if(index>=0)return value(record.data[index],fields[index].type);
          if(record.kind==='exception'&&node.name==='Message')return value(record.data[0],'string');
          throw new Error('Unknown member; computed property getters are not executed by watch evaluation');
        }
        case 'Conditional':return truth(walk(node.condition))?walk(node.whenTrue):walk(node.whenFalse);
        case 'Unary':{const v=walk(node.operand);if(node.operator==='!')return value(!truth(v),'bool');if(!['+','-','~'].includes(node.operator)||!primitive.has(v.type))throw new Error('Side-effect-free numeric unary expression required');const raw=this.vm.value(v.value);if(checked&&v.type==='int'&&node.operator==='-'&&raw===-2147483648)throw new Error('OverflowException: checked negation');return value(node.operator==='+'?raw:node.operator==='-'?(v.type==='int'?(-raw)|0:-raw):~raw,v.type);}
        case 'Binary':{
          const l=walk(node.left),op=node.operator;if(op==='&&')return value(truth(l)&&truth(walk(node.right)),'bool');if(op==='||')return value(truth(l)||truth(walk(node.right)),'bool');if(op==='??')return l.value===null?walk(node.right):l;
          const r=walk(node.right),a=this.vm.value(l.value),b=this.vm.value(r.value);
          if(op==='+'&&(l.type==='string'||r.type==='string')){const text=this.vm.format(l.value,l.type)+this.vm.format(r.value,r.type);if(text.length>1000000)throw new RangeError('Watch string exceeds limit');return value(text,'string');}
          if(['==','!='].includes(op)&&((l.type==='bool'&&r.type==='bool')||(['string','null'].includes(l.type)&&['string','null'].includes(r.type))))return value(op==='=='?a===b:a!==b,'bool');
          if(['==','!=','<','<=','>','>='].includes(op)){const comparison={'==':'eq','!=':'ne','<':'lt','<=':'le','>':'gt','>=':'ge'}[op];return value(this.vm.compare(a,b,comparison,false),'bool');}
          const instruction={'+':'add','-':'sub','*':'mul','/':'div','%':'rem','&':'and','|':'or','^':'xor','<<':'shl','>>':'shr'}[op];if(!instruction)throw new Error('Unsupported watch operator');
          const floating=l.type==='double'||r.type==='double',operand=v=>floating?{float:'r8',value:Number(this.vm.value(v))}:v;
          return value(this.vm.binary(instruction+(checked&&!floating&&['add','sub','mul'].includes(instruction)?'.ovf':''),operand(l.value),operand(r.value)),floating?'double':l.type);
        }
        default:throw new Error('Watch expressions cannot execute methods, assignments, allocation or property getters');
      }
    };
    const result=walk(this.parse(expression));return {...result,result:result.type==='bool'?(result.value?'True':'False'):this.vm.display(result.value),reference:isReference(result.value)?result.value:null};
  }
  setVariable(frameId,name,expression){
    if(this.vm.state!=='paused')throw new Error('Variables can only be edited while paused');const frame=this.frame(frameId),slot=this.slots(frame).find(s=>s.name===name||s.aliases.includes(name));
    if(!slot||slot.name==='this')throw new Error('Unknown or read-only variable');if(slot.type.endsWith('&'))throw new Error('Editing managed pointers is not supported');
    if(slot.readOnly)throw new Error('Cannot edit a constant');const result=this.evaluate(expression,frameId);let next;this.remember();
    if(primitive.has(slot.type)||slot.type==='string'){
      if(slot.type==='bool'&&result.type!=='bool'||slot.type==='string'&&!['string','null'].includes(result.type))throw new Error('Variable type mismatch');
      next=this.vm.marshal(this.vm.value(result.value),slot.type);
    }else {if(result.value!==null&&(!isReference(result.value)||slot.type!=='object'&&!this.vm.matches(result.value,slot.type)))throw new Error('Variable type mismatch');next=result.value;}
    this.vm.dereference(Object.freeze({...this.vm.address(slot.kind,slot.index),frameId:frame.id}),true,next);this.rememberStop();return this.variable(slot.name,slot.type,next);
  }
  disassemble(reference,{instructionOffset=0,instructionCount=100,offset=0}={}){
    if(!Number.isInteger(instructionOffset)||!Number.isInteger(instructionCount)||instructionCount<0||instructionCount>1000)throw new RangeError('Invalid disassembly page');
    const p=this.location(reference,offset),start=p.method.instructions.findIndex(i=>i.offset===p.offset)+instructionOffset;
    if(start<0||start>p.method.instructions.length)throw new RangeError('Instruction page starts outside the method');
    const bytes=this.vm.inspector.pe.methodBody(p.token).code;
    return p.method.instructions.slice(start,start+instructionCount).map(i=>({address:address(p.token,i.offset),instruction:`${i.label}: ${i.name}${i.operandText?' '+i.operandText:''}`,
      instructionBytes:Array.from(bytes.subarray(i.offset,i.offset+i.size),b=>b.toString(16).padStart(2,'0')).join(' '),symbol:p.method.owner+'::'+p.method.name,
      ...(i.point?{location:{name:i.point.uri,path:i.point.uri},line:i.point.line,column:i.point.column}:{})}));
  }
  state(){this.syncHostHistory();
    const fault=this.vm.pendingFault??this.vm.fault,frames=this.stackTrace(),top=frames[0];
    return {runtime:this.vm.platform.runtimeInfo(),threadId:this.vm.scheduler.currentId,threads:this.threads(),logicalConcurrency:true,uiActive:this.vm.platform.windows.size>0,codeVersion:this.codeVersion??0,state:this.vm.state,reason:this.reason,profile:'managed-il',point:top?.point??null,frames,
      locals:this.vm.top?this.locals():[],output:this.vm.output.join(''),returnValue:this.vm.resultDisplay(),exitCode:this.vm.exitCode,
      breakpointsEnabled:this.breakpointsEnabled,breakpoints:this.breakpoints.map(publicBreakpoint),functionBreakpoints:this.functionBreakpoints.map(publicBreakpoint),exceptionSettings:{mode:this.exceptionBreak,rules:this.exceptionRules},dataBreakpoints:this.dataBreakpoints.map(publicBreakpoint),history:{count:this.history.length,bytes:this.historyBytes,enabled:this.recordHistory,dropped:this.historyDropped,maxCount:this.maxHistory,maxBytes:this.maxHistoryBytes},stats:this.vm.statistics(),fault:fault?{type:fault.name,message:fault.message,frames:fault.frames??[]}:null};
  }
}
export { address as instructionReference };
