import {registerFrame} from '../packages/runtime/src/execution/frame-lifetimes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '@sharpforge/runtime';
import {SyncPrimitives} from '../packages/runtime/src/execution/sync-primitives.js';
import {address,dereference} from '../packages/runtime/src/execution/managed-pointers.js';
import {float,number,nativeInteger} from '../packages/runtime/src/execution/numeric-ops.js';
import {SUSPENDED} from '../packages/runtime/src/platform.js';
import {isSynchronizationIntrinsic} from '../packages/cil/src/sync-intrinsic-profile.js';

// This isolated scheduler harness is a unit-test adapter, not native qualification.
function harness({nativeIntBits=32}={}) {
  const heap=new ManagedHeap(),tasks=new Map(),contexts=new Map([[1,{id:1,status:'running',frames:[],stack:[]}],[2,{id:2,status:'ready',frames:[],stack:[]}],[3,{id:3,status:'ready',frames:[],stack:[]}]]);
  const vm={heap,snapshotOwner:Object.freeze({}),options:{nativeIntBits},frames:[],image:{methods:[]},state:'running'};
  const scheduler={currentId:1,contexts,clock:0,suppressed:false,ensure(){},now(){return this.clock;},get current(){return contexts.get(this.currentId);},
    createTask(resultType){const ref=heap.object('object',[]),task={ref,resultType,status:'waiting',waiters:new Set()};tasks.set(ref.h,task);return task;},
    taskRecord(ref){return tasks.get(ref.h);},
    wait(ref,options){this.current.wait={task:ref,...options};this.current.status='waiting';this.taskRecord(ref).waiters.add(this.currentId);return SUSPENDED;},
    complete(task,result=null,error=null,canceled=false){if(task.status!=='waiting')return;Object.assign(task,{result,error,status:canceled?'canceled':error?'faulted':'completed'});for(const id of task.waiters){const c=contexts.get(id);if(['completed','faulted','canceled'].includes(c.status))continue;c.result=result;c.resumeFault=error;c.wait=null;c.status='ready';}task.waiters.clear();}
  };
  vm.scheduler=scheduler;vm.dereference=(...args)=>dereference(vm,...args);vm.sync=new SyncPrimitives(vm);
  const select=id=>{scheduler.currentId=id;const context=contexts.get(id);if(context.status!=='waiting')context.status='running';vm.frames=context.frames;};
  const slot=(type,value,readonly=false)=>{const id=vm.image.methods.length,frame={id:id+1,methodId:id,locals:[value]};vm.image.methods.push({locals:[{type}]});registerFrame(vm,frame);scheduler.current.frames.push(frame);vm.frames=scheduler.current.frames;return address(vm,'local',0,null,{frameId:frame.id,type,readonly});};
  const call=(owner,name,parameters,returnType,args,extra={})=>vm.sync.invoke({owner:'System.Threading.'+owner,name,signature:{parameters,returnType,isStatic:true,...extra.signature},...extra},args);
  return {vm,heap,sync:vm.sync,scheduler,tasks,contexts,select,slot,call};
}

test('A05 T30 Monitor is reentrant, validates ownership and keeps managed identity',()=>{
  const {heap,sync,select}=harness(),gate=heap.object('object',[]);
  assert.equal(sync.enter(gate),null);sync.enter(gate);assert.equal(sync.block(gate).depth,2);
  select(2);assert.throws(()=>sync.exit(gate),{name:'SynchronizationLockException'});assert.throws(()=>sync.pulse(gate),{name:'SynchronizationLockException'});
  assert.equal(sync.enter(gate,{tryEnter:true,timeout:0}),false);
  select(1);sync.exit(gate);assert.equal(sync.block(gate).depth,1);sync.exit(gate);assert.equal(sync.blocks.size,0);
  assert.throws(()=>sync.exit(gate),{name:'SynchronizationLockException'});
  assert.throws(()=>sync.enter(null),{name:'ArgumentNullException'});
  assert.throws(()=>sync.enter({}),{name:'ArgumentException'});
  const foreign=new ManagedHeap().object('object',[]);assert.throws(()=>sync.enter(foreign));
});

test('A05 T30 Enter queues contenders and only grants after the final recursive exit',()=>{
  const {heap,sync,select,contexts}=harness(),gate=heap.object('object',[]);
  sync.enter(gate);sync.enter(gate);select(2);assert.equal(sync.enter(gate),SUSPENDED);select(3);assert.equal(sync.enter(gate),SUSPENDED);
  select(1);sync.exit(gate);assert.equal(contexts.get(2).status,'waiting');sync.exit(gate);assert.equal(sync.block(gate).owner,2);
  select(2);sync.exit(gate);assert.equal(sync.block(gate).owner,3);select(3);sync.exit(gate);assert.equal(sync.blocks.size,0);
});

test('A05 T30 Wait/Pulse restores recursion and pulses do not accumulate',()=>{
  const {heap,sync,select,contexts}=harness(),gate=heap.object('object',[]);
  sync.enter(gate);sync.pulse(gate);sync.enter(gate);assert.equal(sync.wait(gate),SUSPENDED);
  assert.equal(sync.block(gate).conditions.length,1);assert.equal(sync.block(gate).owner,null);
  select(2);sync.enter(gate);sync.pulse(gate);assert.equal(contexts.get(1).status,'waiting');sync.exit(gate);
  assert.equal(contexts.get(1).result,true);assert.equal(sync.block(gate).owner,1);assert.equal(sync.block(gate).depth,2);
  select(1);sync.exit(gate);sync.exit(gate);
});

test('A05 T30 Wait timeout first queues reacquisition, PulseAll readies every waiter',()=>{
  const {heap,sync,select,scheduler,contexts}=harness(),gate=heap.object('object',[]);
  sync.enter(gate);sync.enter(gate);sync.wait(gate,10);select(2);sync.enter(gate);
  assert.equal(sync.nextDelay(),10);scheduler.clock=10;sync.poll();assert.equal(contexts.get(1).status,'waiting');assert.equal(sync.block(gate).entries[0].result,false);
  sync.exit(gate);assert.equal(contexts.get(1).result,false);select(1);sync.exit(gate);sync.exit(gate);
  sync.enter(gate);sync.wait(gate);select(2);sync.enter(gate);sync.wait(gate);select(3);sync.enter(gate);sync.pulse(gate,true);sync.exit(gate);
  assert.equal(sync.block(gate).owner,1);select(1);sync.exit(gate);assert.equal(sync.block(gate).owner,2);select(2);sync.exit(gate);
});

test('A05 T30 TryEnter timeout and lockTaken use the original managed Boolean slot',()=>{
  const {heap,sync,select,scheduler,slot,vm}=harness(),gate=heap.object('object',[]),flag=slot('bool',false);
  sync.enter(gate,{flag});assert.equal(!!vm.dereference(flag),true);assert.throws(()=>sync.enter(gate,{flag}),{name:'ArgumentException'});
  select(2);const contender=slot('bool',false);sync.enter(gate,{tryEnter:true,timeout:5,flag:contender});scheduler.clock=5;sync.poll();assert.equal(!!vm.dereference(contender),false);
  select(1);sync.exit(gate);
  for(const timeout of [-2,2147483648,NaN,0.5])assert.throws(()=>sync.enter(gate,{tryEnter:true,timeout}),{name:'ArgumentOutOfRangeException'});
  assert.throws(()=>sync.enter(gate,{flag:slot('int',0)}),{name:'InvalidProgramException'});
});

test('A05 T30 deadlock reports cycles and context termination preserves abandoned ownership',()=>{
  const {heap,sync,select,contexts}=harness(),a=heap.object('object',[]),b=heap.object('object',[]);
  sync.enter(a);select(2);sync.enter(b);sync.enter(a);select(1);sync.enter(b);
  const report=sync.deadlocks();assert.equal(report.cycles.length,1);assert.deepEqual([...report.cycles[0].contextIds].sort(),[1,2]);
  contexts.get(2).status='faulted';sync.cancelContext(2);assert.equal(sync.deadlocks().abandoned[0].owner,2);assert.equal(sync.block(b).owner,2);
  sync.clear();assert.equal([...sync.roots()].length,0);
});

test('A05 T30 monitor roots, snapshots, cancellation and suppressed evaluation keep queues consistent',()=>{
  const {heap,sync,select,scheduler,contexts}=harness(),gate=heap.object('object',[]);
  sync.enter(gate);select(2);sync.enter(gate);const saved=sync.snapshot();assert([...sync.roots()].includes(gate));
  heap.rootProvider=()=>sync.roots();heap.collect();assert(heap.get(gate));
  contexts.get(2).status='canceled';sync.cancelContext(2);assert.equal(sync.block(gate).entries.length,0);sync.restore(saved);assert.equal(sync.block(gate).entries.length,1);
  saved.blocks[0][1].entries.length=0;assert.equal(sync.block(gate).entries.length,1);
  scheduler.suppressed=true;select(3);assert.throws(()=>sync.enter(gate),{name:'InvalidOperationException'});assert.equal(sync.block(gate).entries.length,1);
});

test('A05 T30 Interlocked returns old/new values correctly and wraps exact integer widths',()=>{
  const {slot,call,vm}=harness();
  for(const [type,start,one,min] of [['int',2147483647,1,-2147483648],['uint',-1,1,0],['long',9223372036854775807n,1n,-9223372036854775808n],['ulong',-1n,1n,0n]]) {
    const p=slot(type,start);assert.equal(call('Interlocked','Increment',[type+'&'],type,[p]).value,min);
    assert.equal(call('Interlocked','Exchange',[type+'&',type],type,[p,one]).value,min);
    assert.equal(call('Interlocked','CompareExchange',[type+'&',type,type],type,[p,start,min]).value,one);assert.equal(vm.dereference(p),one);
    assert.equal(call('Interlocked','CompareExchange',[type+'&',type,type],type,[p,start,one]).value,one);assert.equal(vm.dereference(p),start);
  }
  const p=slot('int',15);assert.equal(call('Interlocked','And',['int&','int'],'int',[p,3]).value,15);assert.equal(vm.dereference(p),3);
  assert.equal(call('Interlocked','Or',['int&','int'],'int',[p,8]).value,3);assert.equal(vm.dereference(p),11);
});

test('A05 T30 CompareExchange observes IEEE bits, reference identity and native width',()=>{
  const {slot,call,heap,vm}=harness({nativeIntBits:64});
  for(const [type,kind] of [['float','r4'],['double','r8']]) {
    const p=slot(type,float(-0,kind));call('Interlocked','CompareExchange',[type+'&',type,type],type,[p,float(1,kind),float(0,kind)]);assert(Object.is(number(vm.dereference(p)),-0));
    call('Interlocked','CompareExchange',[type+'&',type,type],type,[p,float(1,kind),float(-0,kind)]);assert.equal(number(vm.dereference(p)),1);
  }
  const a=heap.object('object',[]),b=heap.object('object',[]),reference=slot('object',a);
  call('Interlocked','CompareExchange',['object&','object','object'],'object',[reference,b,a]);assert.equal(vm.dereference(reference),b);
  const native=slot('nint',nativeInteger(1,64));call('Interlocked','Exchange',['nint&','nint'],'nint',[native,nativeInteger(1n<<40n,64)]);assert.equal(number(vm.dereference(native)),1n<<40n);
});

test('A05 T30 Volatile validates addresses, supports barriers and rejects wrong signatures',()=>{
  const {slot,call,vm,sync}=harness(),p=slot('long',1n);
  call('Volatile','Write',['long&','long'],'void',[p,9223372036854775807n]);assert.equal(call('Volatile','Read',['long&'],'long',[p]).value,9223372036854775807n);
  assert(sync.fenceRevision>=3);assert.throws(()=>call('Interlocked','Exchange',['long&','long'],'long',[slot('long',0n,true),1n]),{name:'InvalidProgramException'});
  assert.throws(()=>call('Interlocked','Exchange',['int&','int'],'int',[p,1]),{name:'InvalidProgramException'});
  assert.throws(()=>call('Volatile','Read',['int&'],'int',[null]),{name:'NullReferenceException'});
  assert.equal(call('Interlocked','Exchange',['int&','int'],'double',[p,1]).handled,false);
  const descriptor={owner:'System.Threading.Interlocked',name:'Exchange',methodArguments:['string'],signature:{isStatic:true,parameters:['string&','string'],returnType:'string'}};
  assert.equal(isSynchronizationIntrinsic(descriptor),true);assert.equal(isSynchronizationIntrinsic({...descriptor,signature:{...descriptor.signature,returnType:'object'}}),false);
  assert.equal(vm.dereference(p),9223372036854775807n);
});

test('A05 T30 generic atomic methods accept references and primitives but reject aggregate structs',()=>{
  const {slot,call,vm,heap}=harness(),p=slot('bool',false);
  const extra={methodArguments:['bool'],signature:{parameters:['bool&','bool'],returnType:'bool',isStatic:true,genericArity:1}};
  assert.equal(call('Interlocked','Exchange',['bool&','bool'],'bool',[p,true],extra).value,false);
  assert.equal(!!vm.dereference(p),true);
  const text=heap.string('old'),next=heap.string('new'),reference=slot('string',text);
  assert.equal(call('Interlocked','Exchange',['string&','string'],'string',[reference,next],{methodArguments:['string']}).value,text);
  assert.equal(vm.dereference(reference),next);
  assert.throws(()=>call('Volatile','Read',['bool&'],'bool',[p],{methodArguments:['bool']}),{name:'NotSupportedException'});
  heap.methodTables.define({name:'Pair',base:'System.ValueType',flags:{valueType:true},fields:[]});
  const aggregate=slot('Pair',null);
  assert.throws(()=>call('Interlocked','Exchange',['Pair&','Pair'],'Pair',[aggregate,null],{methodArguments:['Pair']}),{name:'NotSupportedException'});
});
