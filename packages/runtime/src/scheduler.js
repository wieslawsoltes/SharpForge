import {executionFrames} from './execution/callback-frames.js';
import {loadContext,parkContext} from './execution/context-transitions.js';
import {snapshotSchedulerState} from './execution/scheduler-snapshot.js';
import {finishContext,cancelContexts} from './execution/frame-retirement.js';
import {enqueueContext} from './execution/enqueue-context.js';
import {schedulerRootValues} from './execution/frame-roots.js';
import {TASK,THREAD,taskResult} from '@sharpforge/framework';
import {invokeDelegate} from './execution/delegate-invocations.js';
import {startAsyncContext} from './execution/async-start.js';
import {postAsyncFault,flushAsyncFault} from './execution/scheduler-async-faults.js';
import {completeTask,taskFailure} from './execution/scheduler-task-delivery.js';
import {resumeScheduledFault} from './execution/task-fault-boundary.js';
import {afterSchedulerInstruction,schedulerNextDelay} from './execution/scheduler-boundary.js';
import {ManagedFault} from './heap.js';
import {SUSPENDED} from './platform.js';
const key = r => r && `${r.h}:${r.g}`;
const terminal = new Set(['completed','faulted','canceled']);
const contextFields = ['frames','stack','currentPoint','pendingFault','fault','returnValue','exitCode','sourcePause'];
/** Shared-heap cooperative execution contexts. No fake OS-thread identifiers or host promises. */
export class CooperativeScheduler {
  constructor(vm,options={}) {
    this.vm=vm;this.options=options;this.enabled=false;this.suppressed=false;
    this.contexts=new Map();this.tasks=new Map();this.currentId=1;this.nextId=2;this.nextTaskId=1;
    this.unhandledFault=null;this.parked=false;this.quantum=options.schedulerQuantum??256;this.maxContexts=options.maxContexts??1024;this.maxTasks=options.maxTasks??4096;
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
  complete(task,result=null,error=null,canceled=false){return completeTask(this,task,result,error,canceled);}
  failure(task,mode=null){return taskFailure(this,task,mode);}
  enqueue(delegate,args=[],options={}){return enqueueContext(this,delegate,args,options,contextFields);}
  enqueueCall(methodToken,args=[],options={}){return enqueueContext(this,null,args,{...options,methodToken},contextFields);}
  callDelegate(delegate,args){return invokeDelegate(this.vm,delegate,args);}
  postAsyncFault(error){return postAsyncFault(this,error);}
  flushAsyncFault(){return flushAsyncFault(this);}
  wait(ref,{pushResult=true,voidResult=false,forceYield=false,failureMode=null}={}){
    const t=this.taskRecord(ref);if(terminal.has(t.status)&&!forceYield){if(t.status!=='completed')throw this.failure(t,failureMode);return voidResult?null:t.result;}
    if(this.suppressed)throw new ManagedFault('InvalidOperationException','A pending task cannot be awaited during synchronous function evaluation');
    this.ensure();const c=this.current;if(c.task&&key(c.task)===key(ref))throw new ManagedFault('InvalidOperationException','A task cannot await itself');
    let next=t;const visited=new Set();while(next?.contextId&&!visited.has(next.id)){visited.add(next.id);const other=this.contexts.get(next.contextId);if(other?.id===c.id)throw new ManagedFault('InvalidOperationException','Cyclic task wait');next=other?.wait?this.taskRecord(other.wait.task):null;}
    c.wait={task:ref,pushResult,voidResult,failureMode};c.status='waiting';t.waiters.add(c.id);
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
      const t=this.taskRecord(ref);if(d.property==='Result')return this.wait(ref,{pushResult:true,failureMode:'aggregate'});
      if(d.property==='Id')return t.id;
      return p.managed(d.property==='IsCompleted'?terminal.has(t.status):d.property==='IsFaulted'?t.status==='faulted':t.status==='canceled','bool');
    }
    if(d.name==='Wait')return this.wait(ref,{pushResult:wantsResult,voidResult:true,failureMode:'aggregate'});
    if(d.name==='Delay'||d.name==='Yield'){
      const ms=d.name==='Yield'?0:Number(n(values[0]));if(!Number.isInteger(ms)||ms < -1||ms>2147483647)throw new ManagedFault('ArgumentOutOfRangeException','Delay duration must be -1 or a nonnegative Int32');
      const t=this.createTask('void',{...(ms===-1?{}:{deadline:this.now()+ms}),readyTurn:this.turn+1,forceYield:d.name==='Yield'});if(ms===0&&d.name!=='Yield')this.complete(t);return t.ref;
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
  finish(c){return finishContext(this,c);}
  choose(){
    const preferred=this.contexts.get(this.preferred);this.preferred=null;
    if(preferred&&preferred.status==='ready'&&!preferred.frozen)return preferred;
    const ids=[...this.contexts.keys()],at=ids.indexOf(this.currentId);
    for(let i=1;i<=ids.length;i++){const c=this.contexts.get(ids[(at+i)%ids.length]);if(c.status==='ready'&&!c.frozen)return c;}
    return null;
  }
  beforeSlice(){if(this.flushAsyncFault()||!this.enabled||this.suppressed)return;if(['running','ready'].includes(this.vm.state)&&this.current?.frozen){this.save();this.current.status='ready';const next=this.choose();if(next){this.load(next);return;}parkContext(this);}if(this.vm.state!=='waiting')return;this.turn++;this.poll();const next=this.choose();if(next)this.load(next);}
  beforeInstruction(){if(this.enabled&&!this.suppressed)resumeScheduledFault(this);}
  afterInstruction(){return afterSchedulerInstruction(this);}
  freeze(id,frozen=true){this.ensure();const c=this.contexts.get(id);if(!c||terminal.has(c.status))throw new ManagedFault('InvalidOperationException','No live logical context');c.frozen=!!frozen;return this.threads();}
  nextDelay(){return schedulerNextDelay(this);}
  advance(ms){if(!this.virtualTime)throw new ManagedFault('InvalidOperationException','Virtual time is disabled');if(!Number.isFinite(ms)||ms<0)throw new RangeError('Invalid time delta');this.clock+=ms;this.turn++;this.poll();this.beforeSlice();}
  threads(){if(!this.enabled)return [{id:1,name:'Main',kind:'main',status:this.vm.state,frozen:false,parentId:null,taskId:null,frameIds:this.vm.frames.map(f=>f.id)}];this.save();return [...this.contexts.values()].map(c=>({id:c.id,name:c.name,kind:c.kind,status:c.id===this.currentId&&this.vm.state==='paused'?'paused':c.status,frozen:c.frozen,parentId:c.parentId,taskId:c.taskId??null,waitingFor:c.wait?this.vm.platform.get(c.wait.task,'Id'):null,frameIds:c.frames.map(f=>f.id)}));}
  parallelStacks(){this.save();const stack=c=>[...c.frames].reverse().map(f=>this.vm.inspector?{id:f.id,name:f.method.owner+'::'+f.method.name,methodToken:f.method.token,ilOffset:f.method.instructions[f.pc]?.offset??f.lastOffset}:{id:f.id,name:this.vm.image.methods[f.methodId].qualifiedName,methodId:f.methodId,point:f.point});return {kind:'cooperative',contexts:this.enabled?[...this.contexts.values()].filter(c=>!terminal.has(c.status)).map(c=>({...this.threads().find(t=>t.id===c.id),frames:stack(c)})):[{id:1,name:'Main',kind:'main',frames:stack({frames:this.vm.frames})}],tasks:[...this.tasks.values()].map(t=>({id:t.id,status:t.status,contextId:t.contextId??null,waiters:[...t.waiters],dependencies:(t.dependencies??[]).map(r=>this.vm.platform.get(r,'Id')),resultType:t.resultType}))};}
  snapshot(memo=new Map()){return snapshotSchedulerState(this,memo);}
  restore(){throw new ManagedFault('InvalidOperationException','Use vm.restore() to restore scheduler, heap and frame ownership together');}
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
