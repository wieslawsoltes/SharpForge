import test from 'node:test';
import assert from 'node:assert/strict';
import {codedIndex,verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {controlFixture,genericInstance} from './support/control-fixture.js';
import {methodPointer,invokeFunctionPointer} from '../packages/runtime/src/execution/calls.js';
import {constructDelegate,combineDelegates,removeDelegate,delegateEntries,delegatesEqual} from '../packages/runtime/src/execution/delegate-calls.js';
const program=methods=>[{name:'Program',methods}];
const run=(bytes,options={})=>{const result=new CilVirtualMachine(bytes,options).run();assert.equal(result.state,'terminated',result.fault?.stack);return result;};
const identity={name:'Identity',parameters:['object'],result:'object',signature:Uint8Array.from([0x10,1,1,0x1e,0,0x1e,0]),genericParameters:[{}],body:w=>w.op('ldarg.0').op('ret')};

test('A05 T02 MethodSpec substitutes independent closed generic calls and locals',()=>{
  const bytes=controlFixture(program([{name:'Main',result:'int',body:(w,c)=>w.op('ldc.i4',42).op('call',c.methodSpec(c.methods.get('Program.Identity'),[[8]])).op('ldc.i8',9n).op('call',c.methodSpec(c.methods.get('Program.Identity'),[[10]])).op('pop').op('ret')},identity]));
  assert.equal(run(bytes).returnValue,42);
});
test('A05 T02 generic reference constraints reject a value instantiation',()=>{
  const bytes=controlFixture(program([{name:'Main',result:'int',body:(w,c)=>w.op('ldc.i4',42).op('call',c.methodSpec(c.methods.get('Program.Identity'),[[8]])).op('ret')},{...identity,genericParameters:[{flags:4}]}]));
  const result=new CilVirtualMachine(bytes).run();assert.equal(result.state,'faulted');assert.equal(result.fault.name,'ArgumentException');
});
test('A05 T02 ref, out and in share locations and enforce readonly at the callee',()=>{
  const bytes=controlFixture(program([
    {name:'Main',result:'int',locals:['int'],initLocals:false,body:(w,c)=>w.op('ldloca.s',0).op('call',c.methods.get('Program.Out')).op('ldloca.s',0).op('call',c.methods.get('Program.Ref')).op('ldloca.s',0).op('call',c.methods.get('Program.In')).op('ret')},
    {name:'Out',parameters:['int'],parameterFlags:[2],signature:Uint8Array.from([0,1,1,0x10,8]),body:w=>w.op('ldarg.0').op('ldc.i4',40).op('stind.i4').op('ret')},
    {name:'Ref',parameters:['int'],signature:Uint8Array.from([0,1,1,0x10,8]),body:w=>w.op('ldarg.0').op('dup').op('ldind.i4').op('ldc.i4.2').op('add').op('stind.i4').op('ret')},
    {name:'In',parameters:['int'],parameterFlags:[1],signature:Uint8Array.from([0,1,8,0x10,8]),body:w=>w.op('ldarg.0').op('ldind.i4').op('ret')}
  ]));assert.equal(run(bytes).returnValue,42);
  const readOnly=controlFixture(program([{name:'Main',locals:['int'],body:(w,c)=>w.op('ldloca.s',0).op('call',c.methods.get('Program.Bad')).op('ret')},{name:'Bad',parameters:['int'],parameterFlags:[1],signature:Uint8Array.from([0,1,1,0x10,8]),body:w=>w.op('ldarg.0').op('ldc.i4.1').op('stind.i4').op('ret')}]));
  const result=new CilVirtualMachine(readOnly).run();assert.equal(result.state,'faulted');assert.equal(result.fault.name,'InvalidProgramException');assert.match(result.fault.message,/readonly/);
});
test('A05 T02 managed calli validates signatures and opaque pointer ownership',()=>{
  const build=(mismatch=false)=>controlFixture(program([{name:'Main',result:'int',body:(w,c)=>{const sig=c.md.add(17,[c.md.blob(c.signature(mismatch?'long':'int',['int']))]);w.op('ldc.i4',41).op('ldftn',c.methods.get('Program.Increment')).op('calli',sig);if(mismatch)w.op('conv.i4');w.op('ret');}},{name:'Increment',result:'int',parameters:['int'],body:w=>w.op('ldarg.0').op('ldc.i4.1').op('add').op('ret')}]));
  assert.equal(run(build()).returnValue,42);
  const failed=new CilVirtualMachine(build(true)).run();assert.equal(failed.fault.name,'InvalidProgramException');assert.match(failed.fault.message,/signature/);
  const first=new CilVirtualMachine(build()),second=new CilVirtualMachine(build());const pointer=methodPointer(first,0x06000002);
  assert.throws(()=>invokeFunctionPointer(second,pointer,[1]),error=>error.name==='InvalidProgramException');
});
test('A05 T02 tail recursion reuses frames and rejects invalid prefix placement',()=>{
  const bytes=controlFixture(program([{name:'Main',result:'int',body:(w,c)=>w.op('ldc.i4',2000).op('ldc.i4.0').op('call',c.methods.get('Program.Count')).op('ret')},{name:'Count',result:'int',parameters:['int','int'],body:(w,c)=>w.op('ldarg.0').op('brfalse','done').op('ldarg.0').op('ldc.i4.1').op('sub').op('ldarg.1').op('ldc.i4.1').op('add').op('tail.').op('call',c.methods.get('Program.Count')).op('ret').label('done').op('ldarg.1').op('ret')}]));
  assert.equal(run(bytes,{maxFrames:3,maxInstructions:50000}).returnValue,2000);
  const invalid=controlFixture(program([{name:'Main',body:w=>w.op('tail.').op('nop').op('ret')}]));assert.equal(verifyCilAssembly(invalid).success,false);
});
test('A05 T02 local reference escape is rejected at return',()=>{
  const bytes=controlFixture(program([{name:'Main',body:(w,c)=>w.op('call',c.methods.get('Program.Bad')).op('pop').op('ret')},{name:'Bad',locals:['int'],signature:Uint8Array.from([0,0,0x10,8]),body:w=>w.op('ldloca.s',0).op('ret')}]));
  const result=new CilVirtualMachine(bytes).run();assert.equal(result.fault.name,'InvalidProgramException');assert.match(result.fault.message,/outlive/);
});

test('A05 T02 multicast invocation keeps order and returns the final value',()=>{
  const bytes=controlFixture([{name:'Program',fields:[{name:'Order'}],methods:[
    {name:'Main',result:'int',locals:['System.Func`1<int>'],body:(w,c)=>{
      const ctor=c.member('System.Func`1<int>','.ctor','void',['object','nint'],false),invoke=c.member('System.Func`1<int>','Invoke','int',[],false),combine=c.member('System.Delegate','Combine','System.Delegate',['System.Delegate','System.Delegate']);
      w.op('ldnull').op('ldftn',c.methods.get('Program.First')).op('newobj',ctor).op('ldnull').op('ldftn',c.methods.get('Program.Last')).op('newobj',ctor).op('call',combine).op('stloc.0').op('ldloc.0').op('callvirt',invoke).op('ldsfld',c.fields.get('Program.Order')).op('add').op('ret');
    }},
    {name:'First',result:'int',body:(w,c)=>w.op('ldc.i4.1').op('stsfld',c.fields.get('Program.Order')).op('ldc.i4',100).op('ret')},
    {name:'Last',result:'int',body:(w,c)=>w.op('ldsfld',c.fields.get('Program.Order')).op('ldc.i4',10).op('mul').op('ldc.i4.2').op('add').op('stsfld',c.fields.get('Program.Order')).op('ldc.i4',30).op('ret')}
  ]}]);assert.equal(run(bytes).returnValue,42);
  const vm=new CilVirtualMachine(bytes),first=constructDelegate(vm,'System.Func`1<int>',null,methodPointer(vm,0x06000002)),last=constructDelegate(vm,'System.Func`1<int>',null,methodPointer(vm,0x06000003));
  vm.heap.withRoots([first,last],()=>{
    const pair=combineDelegates(vm,first,last);vm.heap.pins.push(pair);const twice=combineDelegates(vm,pair,pair);vm.heap.pins.push(twice);
    assert.deepEqual(delegateEntries(vm,removeDelegate(vm,twice,pair)),[first,last]);assert.equal(removeDelegate(vm,twice,pair,true),null);assert(delegatesEqual(vm,pair,combineDelegates(vm,first,last)));
  });
});

test('A05 T02 closed generic interface declarations retain distinct explicit slots',()=>{
  const interfaceType=kind=>c=>c.typeSpec(genericInstance(c.types.get('I`1'),[[kind]]));
  const bytes=controlFixture([
    {name:'I`1',interface:true,flags:0xa1,genericParameters:[{}],methods:[{name:'Get',static:false,flags:0x5c6,result:'int'}]},
    {name:'C',interfaces:[interfaceType(8),interfaceType(14)],methods:[
      {name:'.ctor',static:false,flags:0x1886,body:(w,c)=>w.op('ldarg.0').op('call',c.member('System.Object','.ctor','void',[],false)).op('ret')},
      {name:'IntGet',static:false,flags:0x1e1,result:'int',body:w=>w.op('ldc.i4',40).op('ret')},
      {name:'StringGet',static:false,flags:0x1e1,result:'int',body:w=>w.op('ldc.i4.2').op('ret')}
    ]},
    {name:'Program',methods:[{name:'Main',result:'int',locals:['C'],body:(w,c)=>w.op('newobj',c.methods.get('C..ctor')).op('stloc.0').op('ldloc.0').op('callvirt',c.member(interfaceType(8)(c),'Get','int',[],false)).op('ldloc.0').op('callvirt',c.member(interfaceType(14)(c),'Get','int',[],false)).op('add').op('ret')}]}
  ],{decorate:c=>{for(const [kind,body] of [[8,'IntGet'],[14,'StringGet']])c.md.add(25,[c.types.get('C')&0xffffff,codedIndex('MethodDefOrRef',c.methods.get('C.'+body)),codedIndex('MethodDefOrRef',c.member(interfaceType(kind)(c),'Get','int',[],false))]);}});
  assert.equal(run(bytes).returnValue,42);
});
test('A05 T02 ldvirtftn captures the derived implementation and rejects a null receiver',()=>{
  const bytes=controlFixture([
    {name:'Base',methods:[{name:'.ctor',static:false,flags:0x1886,body:(w,c)=>w.op('ldarg.0').op('call',c.member('System.Object','.ctor','void',[],false)).op('ret')},{name:'Read',static:false,flags:0x1c6,result:'int',body:w=>w.op('ldc.i4.1').op('ret')}]},
    {name:'Derived',base:'Base',methods:[{name:'.ctor',static:false,flags:0x1886,body:(w,c)=>w.op('ldarg.0').op('call',c.methods.get('Base..ctor')).op('ret')},{name:'Read',static:false,flags:0xc6,result:'int',body:w=>w.op('ldc.i4',42).op('ret')}]},
    {name:'Program',methods:[{name:'Main',result:'int',body:(w,c)=>w.op('newobj',c.methods.get('Derived..ctor')).op('dup').op('ldvirtftn',c.methods.get('Base.Read')).op('newobj',c.member('System.Func`1<int>','.ctor','void',['object','nint'],false)).op('callvirt',c.member('System.Func`1<int>','Invoke','int',[],false)).op('ret')}]}
  ]);assert.equal(run(bytes).returnValue,42);
  const vm=new CilVirtualMachine(bytes);assert.throws(()=>methodPointer(vm,0x06000002,null),error=>error.name==='NullReferenceException');
});
test('A05 T02 external IDisposable declarations dispatch to internal explicit bodies',()=>{
  const bytes=controlFixture([
    {name:'Resource',interfaces:['System.IDisposable'],fields:[{name:'Count'}],methods:[{name:'.ctor',static:false,flags:0x1886,body:(w,c)=>w.op('ldarg.0').op('call',c.member('System.Object','.ctor','void',[],false)).op('ret')},{name:'DisposeBody',static:false,flags:0x1e1,body:(w,c)=>w.op('ldc.i4',42).op('stsfld',c.fields.get('Resource.Count')).op('ret')}]},
    {name:'Program',methods:[{name:'Main',result:'int',body:(w,c)=>w.op('newobj',c.methods.get('Resource..ctor')).op('callvirt',c.member('System.IDisposable','Dispose','void',[],false)).op('ldsfld',c.fields.get('Resource.Count')).op('ret')}]}
  ],{decorate:c=>c.md.add(25,[c.types.get('Resource')&0xffffff,codedIndex('MethodDefOrRef',c.methods.get('Resource.DisposeBody')),codedIndex('MethodDefOrRef',c.member('System.IDisposable','Dispose','void',[],false))])});assert.equal(run(bytes).returnValue,42);
});
test('A05 T02 stop during multicast invocation does not invoke remaining targets',()=>{
  const bytes=controlFixture([{name:'Program',fields:[{name:'Count'}],methods:[
    {name:'Main',body:(w,c)=>{const ctor=c.member('System.Action','.ctor','void',['object','nint'],false);w.op('ldnull').op('ldftn',c.methods.get('Program.First')).op('newobj',ctor).op('ldnull').op('ldftn',c.methods.get('Program.Last')).op('newobj',ctor).op('call',c.member('System.Delegate','Combine','System.Delegate',['System.Delegate','System.Delegate'])).op('callvirt',c.member('System.Action','Invoke','void',[],false)).op('ret');}},
    {name:'First',body:w=>w.op('nop').op('ret')},
    {name:'Last',body:(w,c)=>w.op('ldc.i4.1').op('stsfld',c.fields.get('Program.Count')).op('ret')}
  ]}]);const vm=new CilVirtualMachine(bytes);let budget=100;
  while(!vm.top?.delegateContinuation&&budget--)vm.runSlice({instructionBudget:1,timeBudgetMs:1000});assert(vm.top?.delegateContinuation);vm.stop();vm.heap.collect();assert.equal(vm.run().state,'terminated');assert.equal(vm.statics.get(0x04000001),0);
});
