import {executionFrames} from './execution/callback-frames.js';
import {loadContext,parkContext} from './execution/context-transitions.js';
import {forgetContextSuspension} from './execution/context-events.js';
import {finishContext,cancelContexts} from './execution/frame-retirement.js';
import {schedulerRootValues} from './execution/frame-roots.js';
import {TASK,THREAD,taskResult} from '@sharpforge/framework';
import {boundDelegateCall} from './execution/delegate-targets.js';
import {ManagedFault} from './heap.js';
import {SUSPENDED} from './platform.js';
import {copyExecution} from './snapshot.js';
const key = r => r && `${r.h}:${r.g}`;
const terminal = new Set(['completed','faulted','canceled']);
const contextFields = ['frames','stack','currentPoint','pendingFault','fault','returnValue','exitCode','sourcePause'];
function cloneContext(c) {
  const memo=new Map(),frames=c.frames.map(f=>{const {method,offsets,...rest}=f;return {...copyExecution(rest,memo),...(method?{method,offsets}:{})};});
  return {...c,frames,stack:c.stack?[...c.stack]:undefined,fault:copyExecution(c.fault,memo),pendingFault:copyExecution(c.pendingFault,memo),resumeFault:copyExecution(c.resumeFault,memo),wait:c.wait?{...c.wait}:null};
}
/** Shared-heap cooperative execution contexts. No fake OS-thread identifiers or host promises. */
export class CooperativeScheduler {
  constructor(vm,options={}) {
    this.vm=vm;this.options=options;this.enabled=false;this.suppressed=false;
    this.contexts=new Map();this.tasks=new Map();this.currentId=1;this.nextId=2;this.nextTaskId=1;
    this.parked=false;this.quantum=options.schedulerQuantum??256;this.maxContexts=options.maxContexts??1024;this.maxTasks=options.maxTasks??4096;
    this.virtualTime=!!options.virtualTime;this.clock=0;this.epoch=performance.now();this.turn=0;this.preferred=null;this.steps=0;
  }
  now(){return this.virtualTime?this.clock:Math.max(0,performance.now()-this.epoch);}
  capture(){const c={};for(const k of contextFields)if(k in this.vm)c[k]=this.vm[k];return c;}
  ensure(){if(this.enabled)return;this.enabled=true;this.contexts.set(1,{id:1,name:'Main',kind:'main',status:this.vm.state==='terminated'?'completed':'running',frozen:false,parentId:null,task:null,thread:null,wait:null,...this.capture()});}
  save(){if(!this.enabled||this.parked||this.suppressed)return;const c=this.contexts.get(this.currentId);if(c)Object.assign(c,this.capture());}
  load(c){loadContext(this,c,contextFields);}
  get current(){return this.contexts.get(this.currentId);}
  *roots(){yield* schedulerRootValues(this);}
  allFrames(){return executionFrames(this);}
  taskRecord(ref){this.vm.heap.get(ref);const id=this.vm.platform.get(ref,'Id');let t=this.tasks.get(id);if(!t){const status=this.vm.platform.get(ref,'$status');if(!terminal.has(status))throw new ManagedFault('InvalidOperationException','Task is no longer tracked');t={id,ref,status,result:this.vm.platform.get(ref,'$result'),resultType:taskResult(this.vm.heap.get(ref).type),error:null,waiters:new Set()};}return t;}
  createTask(resultType='void',extra={}){
    this.ensure();this.prune();if(this.tasks.size>=this.maxTasks){this.vm.heap.collect();this.prune();}if(this.tasks.size>=this.maxTasks)throw new ManagedFault('ExecutionLimitException','Managed task limit exceeded');
    const id=this.nextTaskId++,type=resultType==='void'?TASK:TASK+'`1<'+resultType+'>';
    const ref=this.vm.platform.make(type,{Id:id,$status:'waiting',$result:null},'task');
    const t={id,ref,status:'waiting',resultType,result:null,error:null,waiters:new Set(),created:this.now(),...extra};this.tasks.set(id,t);return t;
  }
  complete(t,result=null,error=null,canceled=false){
    if(terminal.has(t.status))return;t.result=result;t.error=error;t.status=canceled?'canceled':error?'faulted':'completed';t.completed=this.now();
    this.vm.heap.withRoots([t.ref,result,error?.reference],()=>{this.vm.platform.set(t.ref,'$status',t.status);this.vm.platform.set(t.ref,'$result',result);if(error){const message=this.vm.heap.string(error.name+': '+error.message);this.vm.heap.withRoots([message],()=>this.vm.platform.set(t.ref,'$error',message));}});
    for(const id of t.waiters){const c=this.contexts.get(id);if(!c||!c.wait||terminal.has(c.status))continue;if(error||canceled)c.resumeFault=error??new ManagedFault('TaskCanceledException','Task was canceled');else if(c.wait.pushResult){const resultValue=c.wait.voidResult?null:result;if(this.vm.inspector)c.frames.at(-1)?.stack.push(resultValue);else c.stack.push(resultValue);}
      c.wait=null;c.status='ready';
    }t.waiters.clear();
  }
  failure(t){return t.error??new ManagedFault(t.status==='canceled'?'TaskCanceledException':'Exception',this.vm.native?.(this.vm.platform.get(t.ref,'$error'))??this.vm.platform.native(this.vm.platform.get(t.ref,'$error'))??'Task failed');}
  enqueue(delegate,args=[],{name=null,kind='task',task=null,parentId=this.currentId,eager=false,thread=null}={}){
    this.ensure();this.prune();const live=[...this.contexts.values()].filter(c=>!terminal.has(c.status));if(live.length>=this.maxContexts)throw new ManagedFault('ExecutionLimitException','Managed context limit exceeded');
    const {method,arguments:values}=boundDelegateCall(this.vm,delegate,args);
    this.save();const previous=this.capture(),previousState=this.vm.state;
    this.vm.frames=[];if(!this.vm.inspector)this.vm.stack=[];this.vm.currentPoint=null;this.vm.pendingFault=null;this.vm.fault=null;this.vm.returnValue=null;this.vm.exitCode=0;
    try{this.vm.call(method,values);}
    catch(error){for(const k of contextFields)if(k in previous)this.vm[k]=previous[k];this.vm.state=previousState;throw error;}
    const id=this.nextId++,c={id,name:name??(this.vm.inspector?(this.vm.inspector.debug?.methods?.find(m=>m.token===method)?.asyncOrigin??this.vm.top.method.name):(this.vm.image.methods[method].asyncOrigin??this.vm.image.methods[method].name)),kind,status:'ready',frozen:false,parentId,task:task?.ref??null,taskId:task?.id??null,thread,delegate,wait:null,eagerParent:eager?parentId:null,...this.capture()};
    this.contexts.set(id,c);if(task)task.contextId=id;
    for(const k of contextFields)if(k in previous)this.vm[k]=previous[k];this.vm.state=previousState;
    if(eager)this.preferred=id;
    if(['terminated','waiting'].includes(previousState)&&!this.vm.frames.length){this.load(c);}
    return id;
  }
  callDelegate(delegate,args){const {method,arguments:values}=boundDelegateCall(this.vm,delegate,args);
    this.vm.call(method,values);return SUSPENDED; // The callee supplies the result on return, without suspending this context.
  }
  wait(ref,{pushResult=true,voidResult=false,forceYield=false}={}){
    const t=this.taskRecord(ref);if(terminal.has(t.status)&&!forceYield){if(t.status!=='completed')throw this.failure(t);return voidResult?null:t.result;}
    if(this.suppressed)throw new ManagedFault('InvalidOperationException','A pending task cannot be awaited during synchronous function evaluation');
    this.ensure();const c=this.current;if(c.task&&key(c.task)===key(ref))throw new ManagedFault('InvalidOperationException','A task cannot await itself');
    let next=t;const visited=new Set();while(next?.contextId&&!visited.has(next.id)){visited.add(next.id);const other=this.contexts.get(next.contextId);if(other?.id===c.id)throw new ManagedFault('InvalidOperationException','Cyclic task wait');next=other?.wait?this.taskRecord(other.wait.task):null;}
    c.wait={task:ref,pushResult,voidResult};c.status='waiting';t.waiters.add(c.id);
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
    if(d.kind==='startTask'){
      const type=taskResult(d.result),t=this.createTask(type);this.vm.heap.withRoots([t.ref],()=>this.enqueue(values[0],[],{kind:d.owner==='SharpForge.Runtime.Async'?'async':'task',task:t,eager:d.owner==='SharpForge.Runtime.Async'&&!this.suppressed}));return t.ref;
    }
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
  poll(){if(!this.enabled||this.suppressed)return;const now=this.now();for(const t of this.tasks.values()){
      if(terminal.has(t.status))continue;
      if(t.deadline!==undefined&&t.deadline<=now&&(t.readyTurn??0)<=this.turn)this.complete(t);
      else if(t.dependencies){const ds=t.dependencies.map(r=>this.taskRecord(r)),done=ds.filter(x=>terminal.has(x.status));if(t.any&&done.length)this.complete(t,done[0].ref);else if(!t.any&&done.length===ds.length){const fault=ds.find(x=>x.status!=='completed');this.complete(t,null,fault?this.failure(fault):null);}}
    }
  }
  finish(c){return finishContext(this,c);}
  choose(){
    const preferred=this.contexts.get(this.preferred);this.preferred=null;
    if(preferred&&preferred.status==='ready'&&!preferred.frozen)return preferred;
    const ids=[...this.contexts.keys()],at=ids.indexOf(this.currentId);
    for(let i=1;i<=ids.length;i++){const c=this.contexts.get(ids[(at+i)%ids.length]);if(c.status==='ready'&&!c.frozen)return c;}
    return null;
  }
  beforeSlice(){if(!this.enabled||this.suppressed)return;if(['running','ready'].includes(this.vm.state)&&this.current?.frozen){this.save();this.current.status='ready';const next=this.choose();if(next){this.load(next);return;}parkContext(this);}if(this.vm.state!=='waiting')return;this.turn++;this.poll();const next=this.choose();if(next)this.load(next);}
  beforeInstruction(){if(!this.enabled||this.suppressed)return;const c=this.current;if(c?.resumeFault){const error=c.resumeFault;c.resumeFault=null;if(this.vm.onException?.(error)){this.vm.pendingFault=error;this.vm.state='paused';return;}if(this.vm.inspector)this.vm.raise(error);else this.vm.handleFault(error);}}
  afterInstruction(){if(!this.enabled||this.suppressed)return;this.turn++;this.steps++;this.save();if(this.vm.state==='paused')return;
    const c=this.current;if(!c)return;
    if(['faulted','terminated'].includes(this.vm.state)){
      if(this.vm.fault&&/LimitException$/.test(this.vm.fault.name)){this.cancelAll();this.vm.state='faulted';return;}
      this.finish(c);
    }
    this.poll();if(c.status==='waiting'&&c.eagerParent){this.preferred=c.eagerParent;c.eagerParent=null;}
    if(c.status==='running'&&!c.frozen&&this.steps<this.quantum&&!this.preferred)return;
    if(c.status==='running')c.status='ready';const next=this.choose();if(next){this.load(next);return;}
    const live=[...this.contexts.values()].some(x=>!terminal.has(x.status));
    if(live){parkContext(this);return;}
    const main=this.contexts.get(1);this.vm.frames=[];if(!this.vm.inspector)this.vm.stack=[];this.vm.returnValue=main?.returnValue??null;this.vm.exitCode=main?.exitCode??0;this.vm.fault=main?.fault??null;this.vm.state=main?.status==='faulted'?'faulted':'terminated';
  }
  freeze(id,frozen=true){this.ensure();const c=this.contexts.get(id);if(!c||terminal.has(c.status))throw new ManagedFault('InvalidOperationException','No live logical context');c.frozen=!!frozen;return this.threads();}
  nextDelay(){const external=this.vm.platform.hostOperations?.active.size;const deadlines=[...this.tasks.values()].filter(t=>!terminal.has(t.status)&&t.deadline!==undefined).map(t=>t.deadline);return deadlines.length?Math.min(external?10:Infinity,Math.max(0,Math.min(...deadlines)-this.now())):external?10:null;}
  advance(ms){if(!this.virtualTime)throw new ManagedFault('InvalidOperationException','Virtual time is disabled');if(!Number.isFinite(ms)||ms<0)throw new RangeError('Invalid time delta');this.clock+=ms;this.turn++;this.poll();this.beforeSlice();}
  threads(){if(!this.enabled)return [{id:1,name:'Main',kind:'main',status:this.vm.state,frozen:false,parentId:null,taskId:null,frameIds:this.vm.frames.map(f=>f.id)}];this.save();return [...this.contexts.values()].map(c=>({id:c.id,name:c.name,kind:c.kind,status:c.id===this.currentId&&this.vm.state==='paused'?'paused':c.status,frozen:c.frozen,parentId:c.parentId,taskId:c.taskId??null,waitingFor:c.wait?this.vm.platform.get(c.wait.task,'Id'):null,frameIds:c.frames.map(f=>f.id)}));}
  parallelStacks(){this.save();const stack=c=>[...c.frames].reverse().map(f=>this.vm.inspector?{id:f.id,name:f.method.owner+'::'+f.method.name,methodToken:f.method.token,ilOffset:f.method.instructions[f.pc]?.offset??f.lastOffset}:{id:f.id,name:this.vm.image.methods[f.methodId].qualifiedName,methodId:f.methodId,point:f.point});return {kind:'cooperative',contexts:this.enabled?[...this.contexts.values()].filter(c=>!terminal.has(c.status)).map(c=>({...this.threads().find(t=>t.id===c.id),frames:stack(c)})):[{id:1,name:'Main',kind:'main',frames:stack({frames:this.vm.frames})}],tasks:[...this.tasks.values()].map(t=>({id:t.id,status:t.status,contextId:t.contextId??null,waiters:[...t.waiters],dependencies:(t.dependencies??[]).map(r=>this.vm.platform.get(r,'Id')),resultType:t.resultType}))};}
  snapshot(){if(!this.enabled)return null;this.save();return {parked:this.parked,currentId:this.currentId,nextId:this.nextId,nextTaskId:this.nextTaskId,clock:this.now(),turn:this.turn,steps:this.steps,preferred:this.preferred,contexts:[...this.contexts].map(([id,c])=>[id,cloneContext(c)]),tasks:[...this.tasks].map(([id,t])=>[id,{...t,error:copyExecution(t.error),waiters:[...t.waiters],dependencies:t.dependencies?[...t.dependencies]:null}])};}
  restore(s){
    forgetContextSuspension(this);
    if(!s){this.parked=false;this.enabled=false;this.contexts.clear();this.tasks.clear();return;}this.enabled=true;this.nextId=Math.max(this.nextId,s.nextId);this.nextTaskId=Math.max(this.nextTaskId,s.nextTaskId);this.parked=!!s.parked;this.currentId=s.currentId;this.clock=s.clock;this.epoch=performance.now()-s.clock;this.turn=s.turn;this.steps=s.steps;this.preferred=s.preferred;this.contexts=new Map(s.contexts.map(([id,c])=>[id,cloneContext(c)]));this.tasks=new Map(s.tasks.map(([id,t])=>[id,{...t,error:copyExecution(t.error),waiters:new Set(t.waiters),dependencies:t.dependencies?[...t.dependencies]:null}]));this.save();}
  prune(){if(!this.enabled)return;for(const [id,t]of this.tasks)if(terminal.has(t.status)){let alive=true;try{this.vm.heap.get(t.ref);}catch{alive=false;}if(!alive)this.tasks.delete(id);}if(this.contexts.size>=this.maxContexts)for(const [id,c]of this.contexts)if(id!==1&&terminal.has(c.status))this.contexts.delete(id);}
  cancelAll(){return cancelContexts(this);}
  async runAsync({signal=null,onSlice=null}={}){while(['ready','running','waiting'].includes(this.vm.state)){
      if(signal?.aborted){this.vm.stop();throw new ManagedFault('OperationCanceledException','Execution canceled');}
      this.vm.runSlice({instructionBudget:10000,timeBudgetMs:8});onSlice?.(this.vm);
      if(this.vm.state==='waiting'){const delay=this.nextDelay();if(delay===null)return this.vm.state;if(this.virtualTime&&!this.vm.platform.hostOperations?.active.size)this.advance(delay);else await new Promise(r=>setTimeout(r,Math.max(1,Math.min(delay,20))));}
      else if(this.vm.state==='running')await new Promise(r=>setTimeout(r,0));
    }return this.vm.state;
  }
}
