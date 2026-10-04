import {contextFrames,threads,parallelStacks,freezeThread,prepareStepOut,stepOutTarget} from './concurrency.js';
import {setNextStatement,gotoTargets,hotReload,evaluateFunction,loadPortableSymbols,releaseEvaluationHandles} from './advanced.js';
import { VirtualMachine, isReference } from '@sharpforge/runtime';
import { SourceBreakpointIndex } from './source-locations.js';
import { sameBreakpointRule,validateBreakpointRule,hitMatches,evaluateBreakpointRule,formatLogpoint,ruleState,restoreRuleState,publicBreakpoint } from './breakpoint-rules.js';
import { parseExpression } from '@sharpforge/syntax';
import {sourceObjectChildren} from './object-children.js';
/** Side-effect-free watch evaluator. It never executes methods, accessors, assignments or host JavaScript. */
export class ExpressionEvaluator {
  constructor(vm){this.vm=vm;this.cache=new Map();}
  parse(text){if(typeof text!=='string'||text.length>16384)throw new RangeError('Watch expression exceeds 16384 characters');if(this.cache.has(text))return this.cache.get(text);const p=parseExpression(text);if(p.diagnostics.length)throw new Error(p.diagnostics[0].message);if(this.cache.size>=256)this.cache.delete(this.cache.keys().next().value);this.cache.set(text,p.expression);return p.expression;}
  evaluate(text,frame=this.vm.top){if(!frame)throw new Error('No stack frame is available');this.budget=1000;this.checkedContext=false;return this.node(this.parse(text),frame);}
  value(value,type){return {value,type:type??(value===null?'null':isReference(value)?this.vm.heap.get(value).type:typeof value==='boolean'?'bool':typeof value==='number'?Number.isInteger(value)?'int':'double':'string')};}
  node(node,frame){
    if(--this.budget<0)throw new Error('Expression evaluation budget exceeded');const vm=this.vm,method=vm.image.methods[frame.methodId];
    switch(node.kind){
      case 'Literal':return this.value(node.value,node.type);
      case 'Name':{
        const matches=method.locals.filter(l=>l.name===node.name&&(l.declaredAt??0)<=(frame.point?.start??Infinity)&&(l.scopeEnd??Infinity)>=(frame.point?.start??0));const local=matches.at(-1);
        if(local){if(frame.locals[local.slot]===undefined)throw new Error(`'${node.name}' is not assigned yet`);return this.value(frame.locals[local.slot],local.type);}
        const owner=vm.image.types.find(t=>t.name===method.owner),field=owner?.fields.find(f=>f.name===node.name);if(field&&!method.isStatic)return this.value(vm.heap.get(frame.locals[0]).data[field.index],field.type);
        const prop=owner?.properties?.find(p=>p.name===node.name);if(prop?.backing){if(prop.isStatic){const i=vm.image.statics.findIndex(s=>s.name===`${method.owner}.${prop.backing}`);return this.value(vm.statics[i],prop.type);}const f=owner.fields.find(f=>f.name===prop.backing);return this.value(vm.heap.get(frame.locals[0]).data[f.index],prop.type);}if(prop)throw new Error('Computed property getters are not executed in watches');const st=vm.image.statics.findIndex(f=>f.name===`${method.owner}.${node.name}`);if(st>=0)return this.value(vm.statics[st],vm.image.statics[st].type);
        throw new Error(`Unknown variable '${node.name}'`);}
      case 'Member':{
        if(node.target.kind==='Name'){const prop=vm.image.types.find(t=>t.name===node.target.name)?.properties?.find(p=>p.name===node.name&&p.isStatic);const index=vm.image.statics.findIndex(s=>s.name===`${node.target.name}.${prop?.backing??node.name}`);if(index>=0)return this.value(vm.statics[index],vm.image.statics[index].type);}
        const receiver=this.node(node.target,frame),raw=vm.value(receiver.value);
        if(node.name==='Length'&&typeof raw==='string')return this.value(raw.length,'int');
        const r=vm.heap.get(receiver.value);if(node.name==='Length'&&r.kind==='array')return this.value(r.data.length,'int');
        if(node.name==='Message'&&r.kind==='exception')return this.value(r.data[0],'string');
        const field=vm.image.types.find(t=>t.name===r.type)?.fields.find(f=>f.name===node.name||f.backing&&f.name===`<${node.name}>k__BackingField`);if(!field)throw new Error(`Unknown field or computed property '${node.name}'; getters are never executed`);return this.value(r.data[field.index],field.type);}
      case 'Checked':case 'Unchecked':{const previous=this.checkedContext;this.checkedContext=node.kind==='Checked';try{return this.node(node.expression,frame);}finally{this.checkedContext=previous;}}
      case 'Default':return this.value(node.type==='int'||node.type==='double'?0:node.type==='bool'?false:null,node.type);
      case 'Cast':{const v=this.node(node.expression,frame);if(!['int','double'].includes(v.type)||!['int','double'].includes(node.type))throw new Error('Only int/double numeric watch casts are supported');if(this.checkedContext&&node.type==='int'&&(!Number.isFinite(v.value)||Math.trunc(v.value)<-2147483648||Math.trunc(v.value)>2147483647))throw new Error('OverflowException: checked conversion');return this.value(node.type==='int'?(Number.isFinite(v.value)&&v.value>=-2147483648&&v.value<2147483648?Math.trunc(v.value)|0:-2147483648):Number(v.value),node.type);}
      case 'Index':{const receiver=this.node(node.target,frame),index=this.node(node.index,frame);if(index.type!=='int')throw new Error('Array index must be int');const record=vm.indexed(receiver.value,index.value);return this.value(record.data[index.value],record.type.slice(0,-2));}
      case 'Unary':{if(['++','--'].includes(node.operator))throw new Error('Watch expressions cannot change program state');const v=this.node(node.operand,frame);if(node.operator==='!')return this.value(!v.value,'bool');if(this.checkedContext&&node.operator==='-'&&v.type==='int'&&v.value===-2147483648)throw new Error('OverflowException: checked negation');if(node.operator==='-')return this.value(v.type==='int'?(-v.value)|0:-v.value,v.type);if(node.operator==='+')return v;return this.value(~v.value,'int');}
      case 'Binary':{
        const left=this.node(node.left,frame);if(node.operator==='&&'&&!left.value)return this.value(false,'bool');if(node.operator==='||'&&left.value)return this.value(true,'bool');if(node.operator==='??'&&left.value!==null)return left;
        const right=this.node(node.right,frame);if(['&&','||','??'].includes(node.operator))return right;
        if(node.operator==='+'&&(left.type==='string'||right.type==='string')){const a=vm.format(left.value),b=vm.format(right.value);if(a.length+b.length>1000000)throw new RangeError('Watch string result exceeds limit');return this.value(a+b,'string');}
        const resultType=['==','!=','<','<=','>','>='].includes(node.operator)?'bool':left.type==='double'||right.type==='double'?'double':left.type;
        return this.value(vm.binary(node.operator,left.value,right.value,resultType==='int'?(this.checkedContext&&['+','-','*'].includes(node.operator)?5:1):resultType==='bool'&&left.type==='bool'?3:0),resultType);}
      case 'Conditional':return this.node(this.node(node.condition,frame).value?node.whenTrue:node.whenFalse,frame);
      default:throw new Error(`'${node.kind}' is not allowed in a side-effect-free watch expression`);
    }
  }
}
export class DebugSession {
  threads(){return threads(this);}
  parallelStacks(){return parallelStacks(this);}
  freezeThread(id,frozen=true){return freezeThread(this,id,frozen);}
  setNextStatement(target){return setNextStatement(this,target);}
  gotoTargets(target){return gotoTargets(this,target);}
  applyChanges(input,options){return hotReload(this,input,options);}
  evaluateFunction(expression,options){return evaluateFunction(this,expression,options);}
  loadSymbols(pdb,sources){return loadPortableSymbols(this,pdb,sources);}
  constructor(image, options={}) {
    this.vm = new VirtualMachine(image, options);
    this.evaluator = new ExpressionEvaluator(this.vm);
    this.sourceIndex = new SourceBreakpointIndex(this.vm.image);
    this.breakpoints = []; this.functionBreakpoints = []; this.dataBreakpoints = [];
    this.breakpointId = 0; this.breakpointIndex = new Map(); this.functionIndex = new Map();
    this.breakpointsEnabled = options.breakpointsEnabled !== false;
    this.stepOverProperties = options.stepOverProperties ?? false;
    this.mode = 'continue'; this.startDepth = 0; this.skipOnce = null;
    this.stoppedBeforeSequence = false; this.reason = null; this.temporaryPoint = null;
    this.exceptionBreak = 'none'; this.exceptionRules = [];
    this.history = []; this.historyBytes = 0; this.historyDropped = 0;
    this.maxHistory = options.maxHistory ?? 64; this.maxHistoryBytes = options.maxHistoryBytes ?? 8*1024*1024;
    this.recordHistory = options.recordHistory ?? false;
    if (!Number.isSafeInteger(this.maxHistory) || this.maxHistory < 0 || this.maxHistory > 10000 ||
        !Number.isSafeInteger(this.maxHistoryBytes) || this.maxHistoryBytes < 0 || this.maxHistoryBytes > 256*1024*1024)
      throw new RangeError('Invalid bounded source history budget');
    this.vm.onException = fault => {
      const rule = this.exceptionRules.find(r => r.name === fault.name || r.name === 'System.'+fault.name || r.name.replace(/^System\./,'') === fault.name.replace(/^System\./,''));
      const mode = rule?.mode ?? this.exceptionBreak;
      if (mode === 'all' || mode === 'uncaught' && !this.willCatch()) {
        this.stopAt({reason:'exception',description:`${fault.name}: ${fault.message}`,exceptionType:fault.name,
          breakMode:mode,phase:'after'}); return true;
      }
      return false;
    };
    this.vm.onWrite = write => this.written(write);
  }
  willCatch() {
    if(this.vm.scheduler.current?.task)return true;return this.vm.frames.some(f => this.vm.image.methods[f.methodId].handlers.some(h =>
      h.kind !== 'finally' && f.pc-1 >= h.start && f.pc-1 < h.end));
  }
  setExceptionBreakpoints({mode='uncaught',rules=[]}={}) {
    if (!['none','all','uncaught'].includes(mode) || !Array.isArray(rules) || rules.length > 256)
      throw new Error('Invalid exception settings');
    const seen = new Set();
    for (const r of rules) {
      if (typeof r.name !== 'string' || !/^(?:System\.)?[A-Za-z_][\w.]*$/.test(r.name) || r.name.length > 256 ||
          !['none','all','uncaught'].includes(r.mode) || seen.has(r.name)) throw new Error('Invalid or duplicate exception rule');
      seen.add(r.name);
    }
    this.exceptionBreak = mode; this.exceptionRules = rules.map(r => ({name:r.name,mode:r.mode}));
    return {mode,rules:this.exceptionRules.map(r => ({...r}))};
  }
  setBreakpointsEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Breakpoint enable switch must be Boolean');
    this.breakpointsEnabled = enabled; return enabled;
  }
  breakpointLocations(uri, range) { return this.sourceIndex.locations(uri, range); }
  setBreakpoints(uri, requested) {
    if (typeof uri !== 'string' || !uri || !Array.isArray(requested) || requested.length > 10000)
      throw new TypeError('Invalid source breakpoint request');
    const previous = this.breakpoints.filter(b => b.uri === uri), used = new Set();
    const result = requested.map(request => {
      const resolved = this.sourceIndex.resolve(uri, request), point = resolved.point;
      const old = previous.find(b => !used.has(b.id) && b.requestedLine === request.line &&
        (b.requestedColumn ?? null) === (request.column ?? null));
      if (old) used.add(old.id);
      const same = sameBreakpointRule(old,request);
      const bp = {...request,id:old?.id ?? ++this.breakpointId,uri,requestedLine:request.line,
        requestedColumn:request.column,line:point?.line ?? request.line,column:point?.column,
        endLine:point?.endLine,endColumn:point?.endColumn,verified:!!point,enabled:request.enabled !== false,
        hits:same ? old?.hits ?? 0 : 0,locations:(resolved.locations ?? []).map(p => ({id:p.id,line:p.line,column:p.column,
          endLine:p.endLine,endColumn:p.endColumn,methodId:p.methodId,ilOffset:p.ilOffset,methodToken:p.methodToken}))};
      // Do not accept caller-supplied internal binding or condition state.
      delete bp.pointId; delete bp.conditionValue; delete bp.conditionSeeded; delete bp.consumed;
      if (same && old) { bp.conditionValue=old.conditionValue; bp.conditionSeeded=old.conditionSeeded; }
      if (request.column !== undefined && point) bp.pointId = point.id;
      if (resolved.message) bp.message = resolved.message; else delete bp.message;
      try { validateBreakpointRule(request, text => this.evaluator.parse(text)); }
      catch (error) { bp.verified=false; bp.message=error.message; }
      return bp;
    });
    this.breakpoints = [...this.breakpoints.filter(b => b.uri !== uri),...result];
    this.breakpointIndex.clear();
    for (const bp of this.breakpoints) for (const location of bp.locations) {
      if (!this.breakpointIndex.has(location.id)) this.breakpointIndex.set(location.id,[]);
      this.breakpointIndex.get(location.id).push(bp);
    }
    return result.map(publicBreakpoint);
  }
  setFunctionBreakpoints(requested) {
    if (!Array.isArray(requested) || requested.length > 10000) throw new RangeError('Invalid function breakpoints');
    const old = this.functionBreakpoints, used = new Set();
    this.functionBreakpoints = requested.map(value => {
      const request = typeof value === 'string' ? {name:value} : value;
      const previous = old.find(b => !used.has(b.id) && b.name === request?.name);
      if (previous) used.add(previous.id);
      const same = sameBreakpointRule(previous,request), bp = {...request,id:previous?.id ?? ++this.breakpointId,
        enabled:request?.enabled !== false,verified:false,hits:same ? previous?.hits ?? 0 : 0,methodIds:[]};
      if (same && previous) {bp.conditionValue=previous.conditionValue;bp.conditionSeeded=previous.conditionSeeded;}
      try {
        if (typeof bp.name !== 'string' || !bp.name.trim() || bp.name.length > 1024) throw new Error('Function name is required');
        const name = bp.name.trim().replaceAll('::','.'), match = /^(.+?)(?:\(([^()]*)\))?$/.exec(name);
        if (!match) throw new Error('Use Method, Type.Method or Type.Method(type, type)');
        const signature = match[2] === undefined ? null : match[2].split(',').map(s=>s.trim()).filter(Boolean);
        const methods = this.vm.image.methods.filter(m => !m.name.startsWith('<startup>') &&
          (m.qualifiedName === match[1] || m.name === match[1]) &&
          (!signature || signature.length === m.parameters.length && signature.every((t,i)=>t===m.parameters[i].type)) &&
          this.sourceIndex.byMethod.has(m.id));
        bp.methodIds = methods.map(m=>m.id); bp.methodId=methods[0]?.id;
        bp.locations = methods.map(m=>({name:m.qualifiedName,...this.sourceIndex.byMethod.get(m.id)[0]}));
        if (!methods.length) throw new Error('No matching function with executable source mapping');
        validateBreakpointRule(request,text=>this.evaluator.parse(text)); bp.verified=true;
      } catch(error) {bp.message=error.message;}
      return bp;
    });
    this.functionIndex.clear();
    for (const bp of this.functionBreakpoints) for (const id of bp.methodIds) {
      if (!this.functionIndex.has(id)) this.functionIndex.set(id,[]);
      this.functionIndex.get(id).push(bp);
    }
    return this.functionBreakpoints.map(publicBreakpoint);
  }
  hitMatches(bp) { return hitMatches(bp); }
  log(text,frame) { return formatLogpoint(text, t=>this.evaluator.evaluate(t,frame), v=>this.vm.format(v)); }
  allBreakpoints() {return [...this.breakpoints,...this.functionBreakpoints,...this.dataBreakpoints];}
  stopAt(reason) {
    this.reason = {...reason,phase:reason.phase ?? 'before'};
    this.stoppedBeforeSequence = this.reason.phase === 'before'; this.temporaryPoint=null;
    const last=this.history.at(-1);
    if (last?.snapshot.instructions === this.vm.instructions) {
      last.stop={...this.reason}; last.stoppedRules=this.allBreakpoints().map(ruleState);
    }
    return true;
  }
  testCandidates(candidates, frame, kind) {
    if (!this.breakpointsEnabled) return [];
    const stops=[];
    for (const bp of candidates) {
      if (bp.enabled === false || bp.verified === false) continue;
      try {
        if (!evaluateBreakpointRule(bp,text=>this.evaluator.evaluate(text,frame),this.vm)) continue;
      } catch(error) {stops.push({bp,kind,error:error.message});continue;}
      if (bp.oneShot) {bp.enabled=false;bp.consumed=true;}
      if (bp.logMessage) {this.vm.emitOutput(this.log(bp.logMessage,frame)+'\n');continue;}
      stops.push({bp,kind});
    }
    return stops;
  }
  sequence(point,frame) {
    const key=frame.id+':'+frame.pc, skip=this.skipOnce===key;
    this.skipOnce=null;
    if (skip) return false;
    const first=!frame.debugEntryVisited;frame.debugEntryVisited=true;
    this.remember(false,true);
    const hits=[...this.testCandidates(this.breakpointIndex.get(point.id)??[],frame,'breakpoint'),
      ...this.testCandidates(first ? this.functionIndex.get(frame.methodId)??[] : [],frame,'function breakpoint')];
    if (hits.length) {
      const hit=hits[0],bp=hit.bp;
      return this.stopAt({reason:hit.kind,breakpointId:bp.id,hitBreakpointIds:hits.map(h=>h.bp.id),
        requestedLocation:bp.uri?{uri:bp.uri,line:bp.requestedLine,column:bp.requestedColumn}:undefined,
        location:{uri:point.uri,line:point.line,column:point.column},
        description:hit.error?'Breakpoint condition failed: '+hit.error:
          `${hit.kind==='function breakpoint'?'Function breakpoint '+bp.name:'Breakpoint'} at ${point.uri}:${point.line}:${point.column}; statement has not executed`,
        conditionError:hit.error});
    }
    const target=this.temporaryPoint;
    if (target?.ids.includes(point.id) && (target.frameId===undefined || target.frameId===frame.id))
      return this.stopAt({reason:'goto',description:'Run to cursor reached the requested statement; it has not executed'});
    const skipAccessor=this.stepOverProperties && this.vm.image.methods[frame.methodId].accessor;
    if (!skipAccessor && (this.mode==='entry' || this.mode==='stepIn' ||
        this.mode==='next' && this.vm.scheduler.currentId===this.startContextId && this.vm.frames.length<=this.startDepth ||
        this.mode==='stepOut' && stepOutTarget(this)))
      return this.stopAt({reason:this.mode==='entry'?'entry':'step',description:this.mode==='entry'?
        'Break on entry: first executable source statement; no breakpoint was hit':'Stepped to the next executable statement'});
    return false;
  }
  resume(mode='continue') {
    releaseEvaluationHandles(this);
    if (!['continue','entry','stepIn','next','stepOut'].includes(mode)) throw new Error('Unknown stepping mode');
    if (['terminated','faulted'].includes(this.vm.state)) return;
    if (this.vm.state==='running') throw new Error('Execution is already running');
    prepareStepOut(this);this.startContextId=this.vm.scheduler.currentId;this.mode=mode; this.startDepth=this.vm.frames.length; this.reason=null;
    this.skipOnce=this.vm.state==='paused' && this.vm.sourcePause && this.vm.top ? this.vm.top.id+':'+this.vm.top.pc : null;
    this.stoppedBeforeSequence=false;if(mode!=='continue')this.temporaryPoint=null;
    this.vm.state=this.vm.scheduler.parked?'waiting':'running';
  }
  start(stopOnEntry=true) {this.resume(stopOnEntry?'entry':'continue');return this;}
  pump(options={}) {const result=this.vm.runSlice({...options,onSequence:(point,frame)=>this.sequence(point,frame)});this.rememberStop();return result;}
  rememberStop(){if(this.vm.state!=='paused'||!this.reason||this.reason.phase==='before')return;this.remember();const last=this.history.at(-1);if(last?.snapshot.instructions===this.vm.instructions&&last.snapshot.writeRevision===this.vm.writeRevision){last.stop={...this.reason};last.stoppedRules=this.allBreakpoints().map(ruleState);}}
  runUntilStop() {while(this.vm.state==='running'||this.vm.state==='ready')this.pump({instructionBudget:50000,timeBudgetMs:50});return this.state();}
  runToCursor(uri,line,column=1) {
    if (!['ready','paused'].includes(this.vm.state)) throw new Error('Pause before running to a cursor');
    const resolved=this.sourceIndex.resolve(uri,{line,column});
    if (!resolved.point) throw new Error(resolved.message);
    const point=resolved.point,frame=this.vm.top;
    this.temporaryPoint={ids:[point.id],...(frame?.methodId===point.methodId?{frameId:frame.id}:{})};
    this.resume();return {uri:point.uri,line:point.line,column:point.column};
  }
  pause() {
    if (['running','waiting'].includes(this.vm.state)) {
      this.vm.state='paused';this.stopAt({reason:'pause',phase:'suspended',description:'Execution interrupted inside the current statement; the next statement may not yet be reached'});
      this.remember();
    }
  }
  stop() {this.temporaryPoint=null;this.skipOnce=null;this.vm.stop();this.reason={reason:'terminated'};}
  dataBreakpointInfo({frameId,name,reference,staticName}={}) {
    let location;
    if (reference) {
      const record=this.vm.heap.get(reference);
      const index=record.kind==='array'?Number(/^\[?(\d+)\]?$/.exec(String(name))?.[1]??-1):
        this.vm.image.types.find(t=>t.name===record.type)?.fields.find(f=>f.name===name)?.index;
      if (Number.isInteger(index)&&index>=0&&index<record.data.length&&['array','object'].includes(record.kind))
        location={kind:record.kind==='object'?'field':'array',handle:reference.h,generation:reference.g,index};
    } else if(staticName!==undefined) {
      const index=this.vm.image.statics.findIndex(s=>s.name===staticName);if(index>=0)location={kind:'static',index};
    } else {
      const frame=this.frame(frameId),at=frame.point?.start??0,local=this.vm.image.methods[frame.methodId].locals.filter(l=>l.name===name&&!l.isConst&&(!l.hidden||l.name==='this')&&(l.declaredAt??0)<=at&&(l.scopeEnd??Infinity)>=at).at(-1);
      if(local)location={kind:'local',index:local.slot,frameId:frame.id};
    }
    return location?{dataId:'source-data:'+encodeURIComponent(JSON.stringify(location)),description:String(name??staticName),accessTypes:['write'],canPersist:false}:
      {dataId:null,description:'No writable managed storage for this selection',accessTypes:[],canPersist:false};
  }
  setDataBreakpoints(requests) {
    if (!Array.isArray(requests)||requests.length>10000) throw new RangeError('Invalid data breakpoints');
    const previous=this.dataBreakpoints;
    this.dataBreakpoints=requests.map(request=>{
      const bp={id:++this.breakpointId,verified:false,enabled:request.enabled!==false,hits:0};
      try {
        if(request.accessType&&request.accessType!=='write')throw new Error('Only write data breakpoints are supported');
        let location=request;
        if(request.dataId!==undefined){if(typeof request.dataId!=='string'||request.dataId.length>4096||!request.dataId.startsWith('source-data:'))throw new Error('Invalid data breakpoint ID');location=JSON.parse(decodeURIComponent(request.dataId.slice(12)));}
        bp.kind=location.kind;bp.index=location.index;
        if(!Number.isSafeInteger(bp.index)||bp.index<0)throw new Error('Invalid storage index');
        if(['array','field'].includes(bp.kind)) {
          bp.handle=location.handle;bp.generation=location.generation;
          const r=this.vm.heap.get({h:bp.handle,g:bp.generation});
          if(r.kind!==(bp.kind==='field'?'object':'array')||bp.index>=r.data.length)throw new Error('Invalid managed heap storage');
        } else if(bp.kind==='local') {
          bp.frameId=location.frameId??this.vm.top?.id;
          if(bp.index>=this.frame(bp.frameId).locals.length)throw new Error('Invalid local slot');
        } else if(bp.kind==='static') {if(bp.index>=this.vm.statics.length)throw new Error('Invalid static slot');}
        else throw new Error('Unsupported data breakpoint');
        for(const k of ['condition','conditionMode','hitCondition','logMessage','oneShot','dataId'])if(request[k]!==undefined)bp[k]=request[k];
        validateBreakpointRule(bp,text=>this.evaluator.parse(text));bp.verified=true;
        const old=previous.find(p=>['kind','index','frameId','handle','generation'].every(k=>p[k]===bp[k]));
        if(old){bp.id=old.id;if(sameBreakpointRule(old,bp)){bp.hits=old.hits;bp.conditionValue=old.conditionValue;bp.conditionSeeded=old.conditionSeeded;}}
      } catch(error){bp.message=error.message;}
      return bp;
    });
    return this.dataBreakpoints.map(publicBreakpoint);
  }
  written(write) {
    const candidates=this.dataBreakpoints.filter(b=>['kind','index','frameId','handle','generation'].every(k=>b[k]===undefined||b[k]===write[k]));
    const hits=this.testCandidates(candidates,this.vm.top,'data breakpoint');
    if(hits.length){this.vm.state='paused';this.stopAt({reason:'data breakpoint',breakpointId:hits[0].bp.id,
      hitBreakpointIds:hits.map(h=>h.bp.id),description:hits[0].error?'Data breakpoint condition failed: '+hits[0].error:
        'Watched storage was written; the highlighted statement has already performed this write',
      phase:'after',write:{...write,oldDisplay:this.vm.display(write.oldValue),newDisplay:this.vm.display(write.value)}});}
  }
  syncHostHistory(){const host=this.vm.platform.hostOperations;if(this.hostHistoryRevision!==host.revision){this.historyDropped+=this.history.length;this.history=[];this.historyBytes=0;this.hostHistoryRevision=host.revision;}return host.active.size===0;}
  remember(force=false,beforeSequence=this.vm.sourcePause) {
    if(!this.syncHostHistory())return;
    if(!this.recordHistory||!this.maxHistory||!this.maxHistoryBytes)return;
    const vm=this.vm,last=this.history.at(-1);
    if(!force&&last?.snapshot.instructions===vm.instructions&&last.snapshot.writeRevision===vm.writeRevision&&last.snapshot.heapRevision===vm.heap.mutationRevision)return;
    const bytes=1024+vm.heap.stats.liveBytes*3+vm.heap.records.length*64+vm.heap.handles.size*96+
      vm.frames.reduce((n,f)=>n+512+f.locals.length*24+(f.unwinds?.length??0)*256,0)+vm.stack.length*24+
      vm.outputCharacters*2+vm.output.length*16+this.allBreakpoints().length*128;
    if(bytes>this.maxHistoryBytes){this.historyDropped++;return;}
    while(this.history.length>=this.maxHistory||this.history.length&&this.historyBytes+bytes>this.maxHistoryBytes){this.historyBytes-=this.history.shift().bytes;this.historyDropped++;}
    const snapshot=vm.snapshot();snapshot.heapRevision=vm.heap.mutationRevision;
    this.history.push({snapshot,bytes,beforeSequence,rules:this.allBreakpoints().map(ruleState)});this.historyBytes+=bytes;
  }
  collect(){if(this.vm.state==='running')throw new Error('Pause before collecting through the debugger');this.remember(true);return this.vm.heap.collect();}
  popHistory() {
    while(this.history.length){const item=this.history.pop();this.historyBytes-=item.bytes;
      if(item.snapshot.instructions===this.vm.instructions&&item.snapshot.writeRevision===this.vm.writeRevision&&item.snapshot.heapRevision===this.vm.heap.mutationRevision)continue;
      return item;}
    return null;
  }
  restoreHistory(item, stopped=false) {
    this.vm.restore(item.snapshot);this.skipOnce=null;this.temporaryPoint=null;this.mode='continue';
    this.stoppedBeforeSequence=!!item.beforeSequence;this.vm.sourcePause=this.stoppedBeforeSequence;
    const rules=stopped?item.stoppedRules??item.rules:item.rules;
    for(const bp of this.allBreakpoints())restoreRuleState(bp,rules?.find(r=>r.id===bp.id));
    this.reason={reason:'step',phase:'before',description:'Restored an earlier managed source snapshot',phase:this.vm.pendingFault?'after':this.stoppedBeforeSequence?'before':'suspended'};
  }
  stepBack() {this.syncHostHistory();
    if(this.vm.state==='running')throw new Error('Pause execution before stepping backward');
    const item=this.popHistory();if(!item)throw new Error('No earlier recorded sequence point is available');
    this.restoreHistory(item);return this.state();
  }
  reverseContinue() {this.syncHostHistory();
    if(this.vm.state==='running')throw new Error('Pause execution before reversing');
    let item,restored=false;
    while((item=this.popHistory())) {
      this.restoreHistory(item,!!item.stop);restored=true;
      if(item.stop&&['entry','breakpoint','function breakpoint','exception','data breakpoint','goto'].includes(item.stop.reason)) {
        this.reason={...item.stop,reverse:true,description:'Reverse continue: '+item.stop.description};return this.state();
      }
    }
    if(!restored)throw new Error('No earlier recorded sequence point is available');
    this.reason={reason:'step',phase:'before',description:'Reached the beginning of retained source history'};return this.state();
  }
  frame(frameId) {const f=frameId===undefined?this.vm.top:this.vm.allFrames().find(f=>f.id===frameId);if(!f)throw new Error('Stack frame no longer exists');return f;}
  evaluate(expression,frameId) {const result=this.evaluator.evaluate(expression,this.frame(frameId));return {...result,result:this.vm.display(result.value),reference:isReference(result.value)?result.value:null};}
  setVariable(frameId,name,expression) {
    if(this.vm.state!=='paused')throw new Error('Variables can only be edited while paused');
    const frame=this.frame(frameId),method=this.vm.image.methods[frame.methodId],offset=frame.point?.start??0;
    const local=method.locals.filter(l=>l.name===name&&!l.hidden&&(l.declaredAt??0)<=offset&&(l.scopeEnd??Infinity)>=offset).at(-1);
    if(!local)throw new Error(`Unknown local '${name}'`);if(local.isConst)throw new Error('Cannot modify a const local');
    let {value,type}=this.evaluator.evaluate(expression,frame);
    const refType=local.type==='string'||local.type==='object'||local.type.endsWith('[]')||this.vm.image.types.some(t=>t.name===local.type);
    if(!(local.type===type||local.type==='double'&&type==='int'||local.type==='object'||value===null&&refType))throw new Error(`Cannot assign ${type} to ${local.type}`);
    if(local.type==='int'&&(!Number.isInteger(value)||value<-2147483648||value>2147483647))throw new Error('Value is outside the Int32 range');
    this.remember(true);if(type==='string'&&typeof value==='string')value=this.vm.heap.string(value);
    frame.locals[local.slot]=value;this.vm.writeRevision++;return {name,value:this.vm.display(value),type:local.type};
  }
  stackTrace(threadId) {
    return [...contextFrames(this,threadId)].reverse().filter(frame=>!this.vm.image.methods[frame.methodId].name.startsWith('<startup>')).map(frame=>{
      const atSequence=frame===this.vm.top&&this.vm.state==='paused'&&this.vm.sourcePause;
      const instruction=atSequence?frame.pc:Math.max(0,frame.pc-1),point=frame.point&&this.sourceIndex.byId.get(frame.point.id);
      return {id:frame.id,name:this.vm.image.methods[frame.methodId].asyncOrigin?this.vm.image.methods[frame.methodId].asyncOrigin+' [async]':this.vm.image.methods[frame.methodId].qualifiedName,methodId:frame.methodId,
        source:point?.uri??null,line:point?.line??0,column:point?.column??0,endLine:point?.endLine,endColumn:point?.endColumn,
        point:point?{...point}:null,pc:frame.pc,isCurrent:frame===this.vm.top,
        methodToken:this.vm.image.il?.methodTokens[frame.methodId]??null,
        ilOffset:this.vm.image.il?.offsets[frame.methodId]?.[instruction]??null};
    });
  }
  locals(frameId) {
    const f=this.frame(frameId),m=this.vm.image.methods[f.methodId],offset=f.point?.start??0;
    return m.locals.filter(l=>(!l.hidden||l.name==='this')&&(l.declaredAt??0)<=offset&&(l.scopeEnd??Infinity)>=offset)
      .map(l=>({name:l.name,type:l.type,value:this.vm.display(f.locals[l.slot]),raw:f.locals[l.slot],
        reference:isReference(f.locals[l.slot])?f.locals[l.slot]:null,slot:l.slot,kind:'local',index:l.slot}));
  }
  statics(){return this.vm.image.statics.map((s,index)=>({name:s.name,type:s.type,value:this.vm.display(this.vm.statics[index]),
    raw:this.vm.statics[index],reference:isReference(this.vm.statics[index])?this.vm.statics[index]:null,index}));}
  children(reference,start=0,count=100) {
    return sourceObjectChildren(this,reference,start,count);
  }
  state() {this.syncHostHistory();
    const frames=this.stackTrace(),point=this.vm.top?.point?this.sourceIndex.byId.get(this.vm.top.point.id):null;
    return {runtime:this.vm.platform.runtimeInfo(),threadId:this.vm.scheduler.currentId,threads:this.threads(),logicalConcurrency:true,uiActive:this.vm.platform.windows.size>0,codeVersion:this.codeVersion??0,state:this.vm.state,reason:this.reason,point:point?{...point}:null,frames,locals:this.vm.top?this.locals():[],
      output:this.vm.output.join(''),fault:this.vm.fault?{type:this.vm.fault.name,message:this.vm.fault.message,frames:this.vm.fault.frames}:
        this.vm.pendingFault?{type:this.vm.pendingFault.name,message:this.vm.pendingFault.message}:null,stats:this.vm.statistics(),
      history:{count:this.history.length,bytes:this.historyBytes,enabled:this.recordHistory,dropped:this.historyDropped,maxCount:this.maxHistory,maxBytes:this.maxHistoryBytes},
      breakpointsEnabled:this.breakpointsEnabled,breakpoints:this.breakpoints.map(publicBreakpoint),
      functionBreakpoints:this.functionBreakpoints.map(publicBreakpoint),dataBreakpoints:this.dataBreakpoints.map(publicBreakpoint),
      exceptionSettings:{mode:this.exceptionBreak,rules:this.exceptionRules.map(r=>({...r}))}};
  }
}

export { CilDebugSession, instructionReference } from './cil-debugger.js';
export { SourceBreakpointIndex } from './source-locations.js';
export {remapSourceBreakpoints,sourceBreakpointAt} from './breakpoints.js';
