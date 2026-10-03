import {markUnhandled} from './execution/unhandled.js';
import {startAsyncContext} from './execution/async-start.js';
import {retainsContextFrames, releaseContextFrames, finishContext, cancelContexts} from './execution/context-lifetimes.js';
import {managedDelegateSignature} from '@sharpforge/cil';
import {callRoots} from './execution/generic-calls.js';
import {arrayContinuationRoots} from './execution/array-ops.js';
import {TASK,THREAD,frameworkType,taskResult} from '@sharpforge/framework';
import {ManagedFault,isReference} from './heap.js';
import {SUSPENDED} from './execution/suspension.js';
import {copyExecution,copyFrames} from './execution/execution-copy.js';
const key = r => r && `${r.h}:${r.g}`;
const terminal = new Set(['completed','faulted','canceled']);
const contextFields = ['frames','stack','currentPoint','pendingFault','fault','returnValue','exitCode','sourcePause'];
function cloneContext(c,memo=new Map()) {
  if(memo.has(c))return memo.get(c);
  const copied={};memo.set(c,copied);
  const frames=copyFrames(c.frames,memo),{frames:original,...state}=c;
  Object.assign(copied,copyExecution(state,memo),{frames});return copied;
}
/** Shared-heap cooperative execution contexts. No fake OS-thread identifiers or host promises. */
export class CooperativeScheduler {
  constructor(vm,options={}) {
    this.vm=vm;this.options=options;this.enabled=false;this.suppressed=false;
    this.contexts=new Map();this.tasks=new Map();this.currentId=1;this.nextId=2;this.nextTaskId=1;
    this.parked=false;this.quantum=options.schedulerQuantum??256;this.maxContexts=options.maxContexts??1024;this.maxTasks=options.maxTasks??4096;
    this.unhandledFault=null;this.virtualTime=!!options.virtualTime;this.clock=0;this.epoch=performance.now();this.turn=0;this.preferred=null;this.steps=0;
  }
  now(){return this.virtualTime?this.clock:Math.max(0,performance.now()-this.epoch);}
  capture(){const c={};for(const k of contextFields)if(k in this.vm)c[k]=this.vm[k];return c;}
  ensure(){if(this.enabled)return;this.enabled=true;this.contexts.set(1,{id:1,name:'Main',kind:'main',status:this.vm.state==='terminated'?'completed':'running',frozen:false,parentId:null,task:null,thread:null,wait:null,...this.capture()});}
  save(){if(!this.enabled||this.parked)return;const c=this.contexts.get(this.currentId);if(c)Object.assign(c,this.capture());}
  load(c){if(this.vm.profiler)this.vm.profiler.resume(c.id);this.parked=false;this.currentId=c.id;for(const k of contextFields)if(k in c)this.vm[k]=c[k];this.vm.state='running';c.status='running';this.steps=0;}
  get current(){return this.contexts.get(this.currentId);}
  *roots(){yield this.unhandledFault?.reference;if(!this.enabled)return;for(const c of this.contexts.values()){
      if(!retainsContextFrames(c))continue;yield c.task;yield c.thread;yield c.delegate;yield c.returnValue;yield c.wait?.task;yield c.resumeFault?.reference;
      if(c.id===this.currentId&&!this.parked)continue;
      yield* c.stack??[];for(const f of c.frames){yield* f.locals??[];yield* f.args??[];for(const v of f.stack??[]){if(v?.byref)yield v.owner;else yield v;}yield f.returnObject;yield f.filterSearch?.error.reference;yield f.asyncBuilderTask;yield* callRoots(f);yield* arrayContinuationRoots(f);if(this.vm.exceptionRoots)yield* this.vm.exceptionRoots(f);else{yield f.exception?.reference;for(const x of f.caught??[])yield x.fault?.reference;for(const x of f.unwinds??[]){yield x.value;yield x.error?.reference;}}}
      yield c.pendingFault?.reference;yield c.fault?.reference;
    }
    for(const t of this.tasks.values())if(!terminal.has(t.status)){yield t.ref;yield* t.dependencies??[];yield t.error?.reference;}
  }
  allFrames(){if(!this.enabled)return this.vm.frames;this.save();return [...this.contexts.values()].flatMap(c=>retainsContextFrames(c)?c.frames:[]);}
  taskRecord(ref){this.vm.heap.get(ref);const id=this.vm.platform.get(ref,'Id');let t=this.tasks.get(id);if(!t){const status=this.vm.platform.get(ref,'$status');if(!terminal.has(status))throw new ManagedFault('InvalidOperationException','Task is no longer tracked');t={id,ref,status,result:this.vm.platform.get(ref,'$result'),resultType:taskResult(this.vm.heap.get(ref).type),error:null,waiters:new Set()};}return t;}
  createTask(resultType='void',extra={}){
    this.ensure();this.prune();if(this.tasks.size>=this.maxTasks){this.vm.heap.collect();this.prune();}if(this.tasks.size>=this.maxTasks)throw new ManagedFault('ExecutionLimitException','Managed task limit exceeded');
    const id=this.nextTaskId++,type=resultType==='void'?TASK:TASK+'`1<'+resultType+'>';
    const ref=this.vm.platform.make(type,{Id:id,$status:'waiting',$result:null},'task');
    const t={id,ref,status:'waiting',resultType,result:null,error:null,waiters:new Set(),created:this.now(),...extra};this.tasks.set(id,t);return t;
  }
  complete(t,result=null,error=null,canceled=false){
    if(terminal.has(t.status))return;t.result=result;t.error=error;t.status=canceled?'canceled':error?'faulted':'completed';t.completed=this.now();
    this.vm.heap.withRoots([t.ref,result,error?.reference],()=>{this.vm.platform.set(t.ref,'$status',t.status);this.vm.platform.set(t.ref,'$result',result);if(error){if(error.reference)this.vm.platform.set(t.ref,'$exception',error.reference);const message=this.vm.heap.string(error.name+': '+error.message);this.vm.heap.withRoots([message],()=>this.vm.platform.set(t.ref,'$error',message));}});
    for(const id of t.waiters){const c=this.contexts.get(id);if(!c||!c.wait||terminal.has(c.status))continue;if((error||canceled)&&c.wait.propagateFault!==false)c.resumeFault=error??new ManagedFault('TaskCanceledException','Task was canceled');else if(c.wait.pushResult){const resultValue=c.wait.voidResult?null:result;if(this.vm.inspector)c.frames.at(-1)?.stack.push(resultValue);else c.stack.push(resultValue);}
      c.wait=null;c.status='ready';
    }t.waiters.clear();
  }
  failure(t){return t.error??new ManagedFault(t.status==='canceled'?'TaskCanceledException':'Exception',this.vm.native?.(this.vm.platform.get(t.ref,'$error'))??this.vm.platform.native(this.vm.platform.get(t.ref,'$error'))??'Task failed');}
  /** Create a logical context while retaining all suspended parent roots. */
  createContext(start,roots,{name='Worker',kind='task',task=null,parentId=this.currentId,eager=false,thread=null,delegate=null,waitTask=null,propagateFault=true}={}) {
    this.ensure();this.prune();
    if([...this.contexts.values()].filter(c=>!terminal.has(c.status)).length>=this.maxContexts)throw new ManagedFault('ExecutionLimitException','Managed context limit exceeded');
    const dependency=waitTask?this.taskRecord(waitTask):null;
    this.save();const previous=this.capture(),previousState=this.vm.state,previousId=this.currentId,previousParked=this.parked;
    const id=this.nextId++,c={id,name,kind,status:'running',frozen:false,parentId,task:task?.ref??null,taskId:task?.id??null,thread,delegate,wait:null,eagerParent:eager?parentId:null,frames:[],stack:[]};
    const keep=[...this.vm.roots(),...roots,waitTask,task?.ref];
    this.vm.heap.withRoots(keep,()=>{
      this.vm.frames=[];if(!this.vm.inspector)this.vm.stack=[];this.vm.currentPoint=null;this.vm.pendingFault=null;this.vm.fault=null;this.vm.returnValue=null;this.vm.exitCode=0;this.vm.state='running';
      this.currentId=id;this.parked=false;this.contexts.set(id,c);
      try {
        const value=start();Object.assign(c,this.capture());
        if(c.status==='running')c.status=c.frames.length?'ready':'completed';
        if(!c.frames.length&&value!==SUSPENDED)c.returnValue=value??null;
        if(dependency&&!terminal.has(dependency.status)) {c.wait={task:waitTask,pushResult:false,voidResult:true,propagateFault};c.status='waiting';dependency.waiters.add(id);if(this.vm.profiler)this.vm.profiler.suspend(id,'dependency');}
        else if(dependency&&dependency.status!=='completed'&&propagateFault)c.resumeFault=this.failure(dependency);
        if(task){task.contextId=id;if(terminal.has(c.status))this.complete(task,c.returnValue,c.fault);}
      } catch(error) {releaseContextFrames(this.vm,{frames:this.vm.frames});this.contexts.delete(id);if(dependency)dependency.waiters.delete(id);throw error;}
      finally {this.currentId=previousId;this.parked=previousParked;for(const key of contextFields)if(key in previous)this.vm[key]=previous[key];this.vm.state=previousState;}
    });
    if(eager&&c.status==='ready')this.preferred=id;
    if(['terminated','waiting'].includes(previousState)&&!this.vm.frames.length&&c.status==='ready')this.load(c);
    return id;
  }
  enqueue(delegate,args=[],options={}) {
    const p=this.vm.platform,r=p.record(delegate);if(r.kind!=='delegate')throw new ManagedFault('InvalidCastException','A managed delegate is required');
    const method=p.get(delegate,'method'),receiver=p.get(delegate,'receiver');
    const signature=this.vm.inspector?managedDelegateSignature(this.vm.inspector,r.type):frameworkType(r.type);
    if(!signature||args.length!==signature.parameters.length)throw new ManagedFault('ArgumentException','Delegate argument count mismatch');
    const target=this.vm.inspector?(this.vm.inspector.methods.has(method)?this.vm.inspector.getMethod(method):p.get(delegate,'pointer')?.descriptor):this.vm.image.methods[method];
    const name=options.name??(this.vm.inspector?(this.vm.inspector.debug?.methods?.find(m=>m.token===method)?.asyncOrigin??target.name):(target.asyncOrigin??target.name));
    return this.createContext(()=>this.callDelegate(delegate,args),[delegate,receiver,...args],{...options,name,delegate});
  }
  enqueueCall(methodToken,args=[],{extra={},...options}={}) {
    const method=this.vm.inspector?this.vm.inspector.getMethod(methodToken):this.vm.image.methods[methodToken];
    return this.createContext(()=>{this.vm.call(methodToken,args,extra);return SUSPENDED;},args,{name:method.name,...options});
  }
  callDelegate(delegate,args){
    if(this.vm.inspector)return this.vm.invokeDelegate(delegate,args);
    const p=this.vm.platform,method=p.get(delegate,'method'),receiver=p.get(delegate,'receiver'),m=this.vm.image.methods[method];
    this.vm.call(method,m.isStatic?args:[receiver,...args]);return SUSPENDED;
  }
  postAsyncFault(error){this.unhandledFault=error;}
  flushAsyncFault(){
    if(!this.unhandledFault||this.suppressed)return false;
    const fault=this.unhandledFault;
    this.vm.heap.withRoots([fault.reference],()=>{
      this.cancelAll();
      this.vm.frames=[];
      if(!this.vm.inspector)this.vm.stack=[];
      this.vm.pendingFault=null;
      this.vm.fault=null;
      this.vm.state='running';
      this.parked=false;
      this.enabled=true;
      const id=this.nextId++;
      this.currentId=id;
      const context={id,name:'Unhandled asynchronous exception',kind:'exception-event',status:'running',
        frozen:false,parentId:null,task:null,thread:null,wait:null,...this.capture()};
      this.contexts.set(id,context);
      markUnhandled(this.vm,fault);
      Object.assign(context,this.capture());
      if(this.vm.state==='faulted'){context.status='faulted';context.preserveFrames=true;}
    });
    return true;
  }
  wait(ref,{pushResult=true,voidResult=false,forceYield=false}={}){
    const t=this.taskRecord(ref);if(terminal.has(t.status)&&!forceYield){if(t.status!=='completed')throw this.failure(t);return voidResult?null:t.result;}
    if(this.suppressed)throw new ManagedFault('InvalidOperationException','A pending task cannot be awaited during synchronous function evaluation');
    this.ensure();const c=this.current;if(c.task&&key(c.task)===key(ref))throw new ManagedFault('InvalidOperationException','A task cannot await itself');
    let next=t;const visited=new Set();while(next?.contextId&&!visited.has(next.id)){visited.add(next.id);const other=this.contexts.get(next.contextId);if(other?.id===c.id)throw new ManagedFault('InvalidOperationException','Cyclic task wait');next=other?.wait?this.taskRecord(other.wait.task):null;}
    c.wait={task:ref,pushResult,voidResult};c.status='waiting';t.waiters.add(c.id);if(this.vm.profiler)this.vm.profiler.suspend(c.id,'task');
    if(forceYield&&terminal.has(t.status)){t.status='waiting';t.deadline=this.now();t.readyTurn=this.turn+1;}
    this.save();return SUSPENDED;
  }
  createThread(delegate){const p=this.vm.platform;p.record(delegate);return p.make(THREAD,{Name:null,ManagedThreadId:0,$delegate:delegate,$started:false,$task:null},'thread');}
  invoke(d,args){this.ensure();const p=this.vm.platform,n=v=>p.native(v),ref=d.isStatic?null:args[0],values=d.isStatic?args:args.slice(1),wantsResult=!this.vm.inspector||d.result!=='void';
    if(d.owner===THREAD){
      if(d.kind==='constructor')return this.createThread(args[0]);
      if(d.kind==='get'){
        if(d.property==='CurrentThread'){const c=this.current;if(!c.thread)c.thread=p.make(THREAD,{Name:this.vm.heap.string(c.name),ManagedThreadId:c.id,$started:true},'thread');return c.thread;}
        if(d.property==='IsAlive'){const task=p.get(ref,'$task');return p.managed(!!task&&!terminal.has(this.taskRecord(task).status),'bool');}
        return p.get(ref,d.property);
      }
      if(d.kind==='set'){p.set(ref,d.property,values[0]);const id=p.get(ref,'ManagedThreadId'),c=this.contexts.get(id);if(c&&d.property==='Name')c.name=String(n(values[0])??c.name);return null;}
      if(d.name==='Start'){if(p.get(ref,'$started'))throw new ManagedFault('ThreadStateException','Thread has already started');const t=this.createTask(),id=this.enqueue(p.get(ref,'$delegate'),[],{name:n(p.get(ref,'Name'))??'Worker',kind:'thread',task:t,thread:ref});p.set(ref,'$started',true);p.set(ref,'ManagedThreadId',id);p.set(ref,'$task',t.ref);return null;}
      if(d.name==='Join'){const task=p.get(ref,'$task');if(!task)throw new ManagedFault('ThreadStateException','Thread has not started');return this.wait(task,{pushResult:wantsResult,voidResult:true});}
      if(d.name==='Sleep'){const ms=Number(n(values[0]));if(!Number.isInteger(ms)||ms<0||ms>86400000)throw new ManagedFault('ArgumentOutOfRangeException','Sleep duration must be 0–86400000 milliseconds');const t=this.createTask('void',{deadline:this.now()+ms});return this.wait(t.ref,{pushResult:wantsResult,voidResult:true});}
      if(d.name==='Yield'){this.steps=this.quantum;return p.managed(true,'bool');}
    }
    if(d.kind==='startTask'||d.kind==='startAsyncVoid')return startAsyncContext(this,d,values[0]);
    if(d.kind==='await')return this.wait(values[0],{pushResult:wantsResult,voidResult:d.result==='void',forceYield:!!this.taskRecord(values[0]).forceYield});
    if(d.kind==='get'){
      if(d.property==='CompletedTask'){const t=this.createTask();this.complete(t);return t.ref;}
      const t=this.taskRecord(ref);if(d.property==='Result')return this.wait(ref,{pushResult:true});
      if(d.property==='Id')return t.id;
      return p.managed(d.property==='IsCompleted'?terminal.has(t.status):d.property==='IsFaulted'?t.status==='faulted':t.status==='canceled','bool');
    }
    if(d.name==='Wait')return this.wait(ref,{pushResult:wantsResult,voidResult:true});
    if(d.name==='Delay'||d.name==='Yield'){
      const ms=d.name==='Yield'?0:Number(n(values[0]));if(!Number.isInteger(ms)||ms<0||ms>86400000)throw new ManagedFault('ArgumentOutOfRangeException','Delay duration must be 0–86400000 milliseconds');
      const t=this.createTask('void',{deadline:this.now()+ms,readyTurn:this.turn+1,forceYield:d.name==='Yield'});if(ms===0&&d.name!=='Yield')this.complete(t);return t.ref;
    }
    if(d.name==='FromResult'){const t=this.createTask(taskResult(d.result));this.complete(t,values[0]);return t.ref;}
    if(d.name==='WhenAll'||d.name==='WhenAny'){
      const a=this.vm.heap.get(values[0]);if(a.kind!=='array')throw new ManagedFault('ArgumentException','Task array required');if(!a.data.length&&d.name==='WhenAny')throw new ManagedFault('ArgumentException','WhenAny requires at least one task');for(const item of a.data)this.taskRecord(item);
      const t=this.createTask(taskResult(d.result),{dependencies:[...a.data],any:d.name==='WhenAny'});this.poll();return t.ref;
    }
    throw new ManagedFault('MissingMethodException',`${d.owner}::${d.name}`);
  }
  poll(){if(!this.enabled||this.suppressed)return;this.vm.sync?.poll();const now=this.now();for(const t of this.tasks.values()){
      if(terminal.has(t.status))continue;
      if(t.deadline!==undefined&&t.deadline<=now&&(t.readyTurn??0)<=this.turn)this.complete(t);
      else if(t.dependencies){const ds=t.dependencies.map(r=>this.taskRecord(r)),done=ds.filter(x=>terminal.has(x.status));if(t.any&&done.length)this.complete(t,done[0].ref);else if(!t.any&&done.length===ds.length){const fault=ds.find(x=>x.status!=='completed');this.complete(t,null,fault?this.failure(fault):null);}}
    }
  }
  finish(c){finishContext(this,c);}
  choose(){
    const preferred=this.contexts.get(this.preferred);this.preferred=null;
    if(preferred&&preferred.status==='ready'&&!preferred.frozen)return preferred;
    const ids=[...this.contexts.keys()],at=ids.indexOf(this.currentId);
    for(let i=1;i<=ids.length;i++){const c=this.contexts.get(ids[(at+i)%ids.length]);if(c.status==='ready'&&!c.frozen)return c;}
    return null;
  }
  beforeSlice() {
    if (this.flushAsyncFault() || !this.enabled || this.suppressed) return;
    // Source restore pauses at a host boundary. Resuming a parked snapshot must
    // reenter the wait path even when the host changes that pause to running.
    if (this.parked && ['ready', 'running'].includes(this.vm.state) && !this.vm.frames.length) {
      this.vm.state = 'waiting';
    }
    if (['running', 'ready'].includes(this.vm.state) && this.current?.frozen) {
      this.save();
      this.current.status = 'ready';
      const next = this.choose();
      if (next) { this.load(next); return; }
      this.parked = true;
      this.vm.state = 'waiting';
      this.vm.frames = [];
      if (!this.vm.inspector) this.vm.stack = [];
    }
    if (this.vm.state !== 'waiting') return;
    this.turn++;
    this.poll();
    const next = this.choose();
    if (next) this.load(next);
  }
  beforeInstruction(){if(!this.enabled||this.suppressed)return;const c=this.current;if(c?.resumeFault){const error=c.resumeFault;c.resumeFault=null;if(this.vm.inspector)this.vm.raise(error);else this.vm.handleFault(error);}}
  afterInstruction(){if(!this.enabled||this.suppressed)return;this.turn++;this.steps++;this.save();if(this.flushAsyncFault())return;if(this.vm.state==='paused')return;
    const c=this.current;if(!c)return;
    if(['faulted','terminated'].includes(this.vm.state)){
      if(this.vm.fault&&/LimitException$/.test(this.vm.fault.name)){this.cancelAll({preserveCurrent:true});this.vm.state='faulted';return;}
      this.finish(c);if(this.flushAsyncFault())return;if(c.preserveFrames){this.cancelAll({preserveCurrent:true});this.vm.state='faulted';return;}
    }
    this.poll();if(c.status==='waiting'&&c.eagerParent){this.preferred=c.eagerParent;c.eagerParent=null;}
    if(c.status==='running'&&!c.frozen&&this.steps<this.quantum&&!this.preferred)return;
    if(c.status==='running')c.status='ready';const next=this.choose();if(next){this.load(next);return;}
    const live=[...this.contexts.values()].some(x=>!terminal.has(x.status));
    if(live){this.parked=true;this.vm.state='waiting';this.vm.frames=[];if(!this.vm.inspector)this.vm.stack=[];return;}
    const main=this.contexts.get(1);this.vm.frames=[];if(!this.vm.inspector)this.vm.stack=[];this.vm.returnValue=main?.returnValue??null;this.vm.exitCode=main?.exitCode??0;this.vm.fault=main?.fault??null;this.vm.state=main?.status==='faulted'?'faulted':'terminated';
  }
  freeze(id,frozen=true){this.ensure();const c=this.contexts.get(id);if(!c||terminal.has(c.status))throw new ManagedFault('InvalidOperationException','No live logical context');c.frozen=!!frozen;return this.threads();}
  nextDelay(){const external=this.vm.platform.hostOperations?.active.size,deadlines=[...this.tasks.values()].filter(t=>!terminal.has(t.status)&&t.deadline!==undefined).map(t=>Math.max(0,t.deadline-this.now())),sync=this.vm.sync?.nextDelay();if(sync!==null&&sync!==undefined)deadlines.push(sync);if(external)deadlines.push(10);return deadlines.length?Math.min(...deadlines):null;}
  advance(ms){if(!this.virtualTime)throw new ManagedFault('InvalidOperationException','Virtual time is disabled');if(!Number.isFinite(ms)||ms<0)throw new RangeError('Invalid time delta');this.clock+=ms;this.turn++;this.poll();this.beforeSlice();}
  threads(){if(!this.enabled)return [{id:1,name:'Main',kind:'main',status:this.vm.state,frozen:false,parentId:null,taskId:null,frameIds:this.vm.frames.map(f=>f.id)}];this.save();return [...this.contexts.values()].map(c=>({id:c.id,name:c.name,kind:c.kind,status:c.id===this.currentId&&this.vm.state==='paused'?'paused':c.status,frozen:c.frozen,parentId:c.parentId,taskId:c.taskId??null,waitingFor:c.wait?this.vm.platform.get(c.wait.task,'Id'):null,frameIds:c.frames.map(f=>f.id)}));}
  parallelStacks(){this.save();const stack=c=>[...c.frames].reverse().map(f=>this.vm.inspector?{id:f.id,name:f.method.owner+'::'+f.method.name,methodToken:f.method.token,ilOffset:f.method.instructions[f.pc]?.offset??f.lastOffset}:{id:f.id,name:this.vm.image.methods[f.methodId].qualifiedName,methodId:f.methodId,point:f.point});return {kind:'cooperative',contexts:this.enabled?[...this.contexts.values()].filter(retainsContextFrames).map(c=>({...this.threads().find(t=>t.id===c.id),frames:stack(c)})):[{id:1,name:'Main',kind:'main',frames:stack({frames:this.vm.frames})}],tasks:[...this.tasks.values()].map(t=>({id:t.id,status:t.status,contextId:t.contextId??null,waiters:[...t.waiters],dependencies:(t.dependencies??[]).map(r=>this.vm.platform.get(r,'Id')),resultType:t.resultType}))};}
  copySnapshot(s,memo=new Map()) {
    if(!s)return null;
    return {...s,unhandledFault:copyExecution(s.unhandledFault,memo),contexts:s.contexts.map(([id,c])=>[id,cloneContext(c,memo)]),tasks:s.tasks.map(([id,t])=>[id,copyExecution(t,memo)])};
  }
  snapshot(memo=new Map()){
    if(!this.enabled)return null;this.save();
    return this.copySnapshot({parked:this.parked,currentId:this.currentId,nextId:this.nextId,nextTaskId:this.nextTaskId,clock:this.now(),turn:this.turn,steps:this.steps,preferred:this.preferred,suppressed:this.suppressed,unhandledFault:this.unhandledFault,contexts:[...this.contexts],tasks:[...this.tasks].map(([id,t])=>[id,{...t,waiters:[...t.waiters]}])},memo);
  }
  restore(s,memo=new Map(),prepared=false){
    if(!s){this.unhandledFault=null;this.parked=false;this.enabled=false;this.suppressed=false;this.contexts.clear();this.tasks.clear();return;}
    if(!prepared)s=this.copySnapshot(s,memo);
    this.enabled=true;this.unhandledFault=s.unhandledFault??null;this.suppressed=!!s.suppressed;this.nextId=Math.max(this.nextId,s.nextId);this.nextTaskId=Math.max(this.nextTaskId,s.nextTaskId);this.parked=!!s.parked;this.currentId=s.currentId;this.clock=s.clock;this.epoch=performance.now()-s.clock;this.turn=s.turn;this.steps=s.steps;this.preferred=s.preferred;
    this.contexts=new Map(s.contexts);this.tasks=new Map(s.tasks.map(([id,t])=>[id,{...t,waiters:new Set(t.waiters)}]));this.save();
  }
  prune(){if(!this.enabled)return;for(const [id,t]of this.tasks)if(terminal.has(t.status)){let alive=true;try{this.vm.heap.get(t.ref);}catch{alive=false;}if(!alive)this.tasks.delete(id);}if(this.contexts.size>=this.maxContexts)for(const [id,c]of this.contexts)if(id!==1&&terminal.has(c.status)&&!c.preserveFrames)this.contexts.delete(id);}
  cancelAll(options){cancelContexts(this,options);}
  async runAsync({signal=null,onSlice=null}={}){while(['ready','running','waiting'].includes(this.vm.state)){
      if(signal?.aborted){this.vm.stop();throw new ManagedFault('OperationCanceledException','Execution canceled');}
      this.vm.runSlice({instructionBudget:10000,timeBudgetMs:8});onSlice?.(this.vm);
      if(this.vm.state==='waiting'){const delay=this.nextDelay();if(delay===null)return this.vm.state;if(this.virtualTime&&!this.vm.platform.hostOperations?.active.size)this.advance(delay);else await new Promise(r=>setTimeout(r,Math.max(1,Math.min(delay,20))));}
      else if(this.vm.state==='running')await new Promise(r=>setTimeout(r,0));
    }return this.vm.state;
  }
}
