import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap,ManagedFault,CilVirtualMachine} from '@sharpforge/runtime';
import {ensureTypeInitialized,completeInitialization,failInitialization,initializationKey,initializationRoots} from '../packages/runtime/src/execution/static-init.js';
import {managedFixture} from './managed-fixtures.js';

function fixture({beforeFieldInit=false,valueType=false,initializer=true}={}) {
  const calls=[],tasks=new Map(),contexts=new Map([[1,{id:1}],[2,{id:2}]]);
  const scheduler={currentId:1,contexts,createTask:(type,extra)=>{const ref={id:tasks.size+1},task={ref,...extra,status:'waiting'};tasks.set(ref,task);return task;},taskRecord:ref=>tasks.get(ref),wait:(ref,options)=>{contexts.get(scheduler.currentId).wait={task:ref,...options};contexts.get(scheduler.currentId).status='waiting';},complete:task=>{task.status='completed';for(const context of contexts.values())if(context.wait?.task===task.ref){context.status='ready';context.wait=null;}}};
  const vm={heap:new ManagedHeap(),initialized:new Map(),scheduler,typeSystem:{types:new Map([[1,{token:1,name:'Example.Type',flags:beforeFieldInit?0x100000:0,baseToken:2}]]),initializers:new Map(initializer?[[1,{token:10}]]:[])},inspector:{metadata:{typeName:()=>valueType?'System.ValueType':'System.Object'}},call:(token,args,extra)=>calls.push({token,args,...extra})};
  vm.heap.rootProvider=()=>initializationRoots(vm);
  return {vm,calls,tasks,contexts};
}
test('A05 T21 precise and beforefieldinit types obey distinct lazy triggers',()=>{
  for(const trigger of ['static-method','constructor','instance-method']) {
    const {vm,calls}=fixture({beforeFieldInit:true});
    assert.equal(ensureTypeInitialized(vm,1,trigger),false);assert.equal(calls.length,0);
    assert.equal(ensureTypeInitialized(vm,1,'field'),true);assert.equal(calls.length,1);
  }
  for(const trigger of ['static-method','constructor','field']) {
    const {vm,calls}=fixture();assert.equal(ensureTypeInitialized(vm,1,trigger),true);assert.equal(calls.length,1);
  }
  const reference=fixture(),value=fixture({valueType:true});
  assert.equal(ensureTypeInitialized(reference.vm,1,'instance-method'),false);
  assert.equal(ensureTypeInitialized(value.vm,1,'instance-method'),true);
});
test('A05 T21 same-context recursive initialization observes partial state and runs once',()=>{
  const {vm,calls}=fixture();assert.equal(ensureTypeInitialized(vm,1),true);
  assert.equal(ensureTypeInitialized(vm,1),false);assert.equal(calls.length,1);
  completeInitialization(vm,calls[0]);assert.equal(ensureTypeInitialized(vm,1),false);
  assert.equal(vm.initialized.get(1).status,'initialized');assert.equal(calls.length,1);
});
test('A05 T21 initializer failure caches a rooted TypeInitializationException and InnerException',()=>{
  const {vm,calls}=fixture();ensureTypeInitialized(vm,1);
  const original=new ManagedFault('InvalidOperationException','original'),wrapped=failInitialization(vm,calls[0],original);
  assert.equal(wrapped.name,'TypeInitializationException');assert.equal(wrapped.innerException,original);
  assert.equal(vm.heap.get(wrapped.reference).data[1],original.reference);
  assert.throws(()=>ensureTypeInitialized(vm,1),error=>error===wrapped);
  vm.heap.collect();assert.equal(vm.heap.get(original.reference).type,'InvalidOperationException');
  assert.throws(()=>ensureTypeInitialized(vm,1),error=>error===wrapped);assert.equal(calls.length,1);
});
test('A05 T21 another scheduler context waits then retries after initialization',()=>{
  const {vm,calls,tasks,contexts}=fixture();ensureTypeInitialized(vm,1);
  vm.scheduler.currentId=2;assert.equal(ensureTypeInitialized(vm,1),true);
  assert.equal(contexts.get(2).status,'waiting');assert.equal(tasks.size,1);assert.equal(calls.length,1);
  vm.scheduler.currentId=1;completeInitialization(vm,calls[0]);
  assert.equal(contexts.get(2).status,'ready');vm.scheduler.currentId=2;
  assert.equal(ensureTypeInitialized(vm,1),false);assert.equal(calls.length,1);
});
test('A05 T21 waiting context retries a cached failure at the triggering instruction',()=>{
  const {vm,calls,contexts}=fixture();ensureTypeInitialized(vm,1);
  vm.scheduler.currentId=2;ensureTypeInitialized(vm,1);
  vm.scheduler.currentId=1;const fault=failInitialization(vm,calls[0],new ManagedFault('Exception','boom'));
  assert.equal(contexts.get(2).status,'ready');vm.scheduler.currentId=2;
  assert.throws(()=>ensureTypeInitialized(vm,1),error=>error===fault);
});
test('A05 T21 initialization wait cycles expose partial state instead of deadlocking',()=>{
  const {vm,calls,tasks,contexts}=fixture();ensureTypeInitialized(vm,1);
  const ownerTask=vm.scheduler.createTask('void',{contextId:2});contexts.get(1).wait={task:ownerTask.ref};
  vm.scheduler.currentId=2;assert.equal(ensureTypeInitialized(vm,1),false);
  assert.equal(calls.length,1);assert.equal(tasks.size,1);
});
test('A05 T21 initialization state is separate for each closed generic identity',()=>{
  const {vm,calls}=fixture();ensureTypeInitialized(vm,1,'field','Example.Type<int>');ensureTypeInitialized(vm,1,'field','Example.Type<string>');
  assert.equal(calls.length,2);assert.notEqual(calls[0].initializes,calls[1].initializes);
  assert.equal(calls[0].initializes,initializationKey(1,'Example.Type<int>'));
  completeInitialization(vm,calls[0]);assert.equal(vm.initialized.get(calls[1].initializes).status,'initializing');
});
test('A05 T21 missing initializers and unknown trigger boundaries are deterministic',()=>{
  const {vm,calls}=fixture({initializer:false});assert.equal(ensureTypeInitialized(vm,1),false);assert.equal(calls.length,0);
  assert.equal(ensureTypeInitialized(vm,999),false);assert.throws(()=>ensureTypeInitialized(vm,1,'unknown'),TypeError);
});
test('A05 T21 a failing managed cctor rethrows on the second field access and keeps its cause',()=>{
  const bytes=managedFixture({fields:[{name:'Value'}],methods:[
    {name:'Main',result:'void',body:w=>w.op('ret')},
    {name:'.cctor',result:'void',body:(w,c)=>w.op('ldstr',0x70000000+c.md.userString('cause')).op('newobj',c.member('System.Exception','.ctor','void',['string'],false)).op('throw')}
  ]});
  const vm=new CilVirtualMachine(bytes),typeToken=vm.top.method.ownerToken;
  assert.equal(vm.ensureInitialized(typeToken,'field'),true);
  assert.equal(vm.run().fault.name,'TypeInitializationException');
  const fault=vm.initialized.get(typeToken).fault;
  vm.heap.collect();assert.throws(()=>vm.ensureInitialized(typeToken,'field'),error=>error===fault);
  const descriptor={kind:'method',owner:'System.Exception',name:'get_InnerException',signature:{isStatic:false,parameters:[],returnType:'System.Exception'}};
  assert.equal(vm.intrinsic(descriptor,[fault.reference]),fault.innerException.reference);
});
test('A05 T21 direct delegate-shaped calls initialize before method entry',()=>{
  const bytes=managedFixture({fields:[{name:'Value'}],methods:[
    {name:'Main',result:'void',body:w=>w.op('ret')},
    {name:'Target',result:'int',body:(w,c)=>w.op('ldsfld',c.fields.Value).op('ret')},
    {name:'.cctor',result:'void',body:(w,c)=>w.op('ldc.i4',42).op('stsfld',c.fields.Value).op('ret')}
  ],decorate:({md})=>{md.rows[2][1][0]&=~0x100000;}});
  const vm=new CilVirtualMachine(bytes);vm.frames=[];vm.initialized.clear();
  const method=[...vm.inspector.methods.values()].find(method=>method.name==='Target');
  vm.call(method.token,[]);assert.equal(vm.top.pc,0);assert.equal(vm.top.needsInitialization,true);
  const result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.returnValue,42);
});
test('A05 T21 failure at a direct method-entry gate cannot enter the target catch clause',()=>{
  const bytes=managedFixture({methods:[
    {name:'Main',result:'void',body:w=>w.op('ret')},
    {name:'Target',result:'void',body:w=>w.mark('try').op('leave','done').mark('catch').op('pop').op('leave','done').mark('done').op('ret'),handlers:(labels,c)=>[{start:labels.get('try'),end:labels.get('catch'),target:labels.get('catch'),handlerEnd:labels.get('done'),catchType:c.resolve('System.Exception')}]},
    {name:'.cctor',result:'void',body:w=>w.op('ldnull').op('throw')}
  ],decorate:({md})=>{md.rows[2][1][0]&=~0x100000;}});
  const vm=new CilVirtualMachine(bytes);vm.frames=[];vm.initialized.clear();
  const method=[...vm.inspector.methods.values()].find(method=>method.name==='Target');vm.call(method.token,[]);
  const result=vm.run();assert.equal(result.state,'faulted');assert.equal(result.fault.name,'TypeInitializationException');
});
test('A05 T21 frame-budget failures retain their fatal resource-fault identity',()=>{
  const {vm}=fixture();vm.call=()=>{throw new ManagedFault('StackOverflowException','limit');};
  assert.throws(()=>ensureTypeInitialized(vm,1),error=>error.name==='StackOverflowException');
});
