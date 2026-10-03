import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap,CilVirtualMachine,VirtualMachine} from '@sharpforge/runtime';
import {compile} from '@sharpforge/compiler';
import {MethodTableRegistry} from '../packages/runtime/src/execution/method-table.js';
import {createValue,copyValue,boxValue,unboxValue,valueDefault,sourceValue} from '../packages/runtime/src/execution/value-types.js';
import {address,dereference,sourceFieldValue,sourceFieldStore,validatePointer,pointerType,asReadonly} from '../packages/runtime/src/execution/managed-pointers.js';
import {storageValue,sourceStorageValue} from '../packages/runtime/src/execution/storage.js';
import {copyExecution} from '../packages/runtime/src/snapshot.js';
import {valueFixture} from './a05-03-fixtures.js';

function tables() {
  return new MethodTableRegistry()
    .define({name:'Inner',base:'System.ValueType',flags:{valueType:true},fields:[{name:'Number',type:'int'},{name:'Text',type:'string'}]})
    .define({name:'Outer',base:'System.ValueType',flags:{valueType:true},fields:[{name:'Value',type:'Inner'}]})
    .define({name:'Choice',base:'System.Enum',flags:{valueType:true,enum:true},enumUnderlyingType:'int'})
    .define({name:'Holder',base:'System.Object',fields:[{name:'Value',type:'Outer'}]});
}
function context() {
  const vm={heap:new ManagedHeap({methodTables:tables()}),snapshotOwner:Object.freeze({}),frames:[{id:1,locals:[undefined,undefined],args:[],stack:[]}],statics:new Map(),writeRevision:0};
  Object.defineProperty(vm,'top',{get:()=>vm.frames.at(-1)});
  vm.heap.rootProvider=function*(){for(const frame of vm.frames){yield* frame.locals;yield* frame.args;yield* frame.stack;}yield* vm.statics.values();};
  return vm;
}
const nested=(vm,n,text=null)=>createValue(vm,'Outer',[createValue(vm,'Inner',[n,text])]);
const numberPointer=(vm,base)=>address(vm,'field',0,address(vm,'field',0,base));

test('a05-03: nested struct copies share only managed object references',()=>{
  const vm=context(),text=vm.heap.string('value'),original=nested(vm,7,text),copy=copyValue(vm,original);
  assert.notEqual(copy,original);assert.notEqual(copy.fields[0],original.fields[0]);assert.equal(copy.fields[0].fields[1],text);
  vm.top.locals=[original,copy];const pointer=numberPointer(vm,address(vm,'local',1,null,{type:'Outer'}));
  dereference(vm,pointer,true,19);
  assert.equal(vm.top.locals[0].fields[0].fields[0],7);assert.equal(vm.top.locals[1].fields[0].fields[0],19);
  assert.equal(copy.fields[0].fields[0],7);assert.equal(Object.isFrozen(original.fields),true);
  assert.throws(()=>{original.fields[0].fields[0]=99;},TypeError);
});

test('a05-03: interior refs follow replaced enclosing values and keep whole owners alive',()=>{
  const vm=context(),text=vm.heap.string('interior'),ref=vm.heap.object('Holder',[nested(vm,1,text)]);
  const pointer=numberPointer(vm,address(vm,'field',0,ref));vm.top.locals[0]=pointer;
  vm.heap.collect();assert.equal(vm.heap.get(text).data,'interior');
  vm.heap.get(ref).data[0]=nested(vm,44,text);assert.equal(dereference(vm,pointer),44);
  dereference(vm,pointer,true,45);assert.equal(vm.heap.get(ref).data[0].fields[0].fields[0],45);
  assert.equal(vm.heap.retentionPath(text).reachable,true);
  vm.top.locals[0]=null;vm.heap.collect();assert.throws(()=>vm.heap.get(ref),{name:'InvalidReferenceException'});
});

test('a05-03: nested array values do not alias and field refs retain arrays',()=>{
  const vm=context(),array=vm.heap.array('Outer',2),zero=valueDefault(vm,'Outer');vm.heap.get(array).data.fill(zero);
  const pointer=numberPointer(vm,address(vm,'array',0,array));vm.top.locals[0]=pointer;
  vm.heap.collect();dereference(vm,pointer,true,8);
  assert.equal(vm.heap.get(array).data[0].fields[0].fields[0],8);assert.equal(vm.heap.get(array).data[1].fields[0].fields[0],0);
});

test('a05-03: boxed primitives, enums and nested structs preserve type and copy boundaries',()=>{
  const vm=context(),source=nested(vm,2),box=boxValue(vm,source,'Outer');vm.top.locals[0]=box;
  const read=unboxValue(vm,box,'Outer'),pointer=numberPointer(vm,address(vm,'box',0,box));
  dereference(vm,pointer,true,6);assert.equal(read.fields[0].fields[0],2);assert.equal(source.fields[0].fields[0],2);
  assert.equal(unboxValue(vm,box,'Outer').fields[0].fields[0],6);
  assert.equal(unboxValue(vm,boxValue(vm,123,'int'),'int'),123);
  const enumBox=boxValue(vm,1,'Choice');assert.equal(vm.heap.get(enumBox).methodTable,vm.heap.methodTables.get('Choice'));
  assert.throws(()=>unboxValue(vm,enumBox,'int'),{name:'InvalidCastException'});
  assert.throws(()=>unboxValue(vm,box,'Inner'),{name:'InvalidCastException'});
  assert.throws(()=>unboxValue(vm,null,'Outer'),{name:'NullReferenceException'});
});

test('a05-03: stack lifetime, invalid bounds, readonly writes and cross-VM pointers are rejected',()=>{
  const vm=context(),other=context();vm.top.locals[0]=17;other.top.locals[0]=99;
  const pointer=address(vm,'local',0,null,{type:'int'});assert.equal(dereference(vm,pointer),17);
  assert.throws(()=>dereference(other,pointer),{name:'InvalidProgramException'});
  assert.throws(()=>dereference(vm,{...pointer}),{name:'InvalidProgramException'});
  assert.throws(()=>address(vm,'local',-1),{name:'InvalidProgramException'});
  assert.throws(()=>address(vm,'local',2),{name:'InvalidProgramException'});
  assert.throws(()=>dereference(vm,address(vm,'local',0,null,{type:'int',readonly:true}),true,1),{name:'InvalidProgramException'});
  vm.frames=[];assert.throws(()=>dereference(vm,pointer),{name:'InvalidProgramException'});
  vm.frames=[{id:2,locals:[99]}];assert.throws(()=>dereference(vm,pointer),{name:'InvalidProgramException'});
});

test('a05-03: out pointers validate uninitialized storage and in pointers reject writes',()=>{
  const vm=context(),pointer=address(vm,'local',0,null,{type:'int'});
  assert.equal(validatePointer(vm,pointer,{write:true,allowUninitialized:true}),pointer);
  assert.throws(()=>validatePointer(vm,pointer),{name:'InvalidProgramException'});
  assert.equal(pointerType(vm,pointer),vm.heap.methodTables.get('int'));
  dereference(vm,pointer,true,42);const readonly=asReadonly(vm,pointer);
  assert.equal(dereference(vm,readonly),42);
  assert.throws(()=>validatePointer(vm,readonly,{write:true}),{name:'InvalidProgramException'});
  assert.throws(()=>dereference(vm,null),{name:'NullReferenceException'});
  const method=Object.freeze({methodPointer:true,vmOwner:vm.snapshotOwner,token:0x06000001});
  assert.equal(storageValue(vm,method,'nint'),method);
  assert.throws(()=>storageValue(context(),method,'nint'),{name:'InvalidProgramException'});
});

test('a05-03: managed pointers cannot escape into fields, arrays, statics or boxes',()=>{
  const vm=context();vm.top.locals[0]=1;const pointer=address(vm,'local',0,null,{type:'int'});
  vm.statics.set(1,null);assert.throws(()=>dereference(vm,address(vm,'static',1),true,pointer),{name:'InvalidProgramException'});
  assert.throws(()=>createValue(vm,'Inner',[1,pointer]),{name:'InvalidProgramException'});
  assert.throws(()=>boxValue(vm,pointer,'int'),{name:'InvalidProgramException'});
  assert.throws(()=>storageValue(vm,pointer,'object'),{name:'InvalidProgramException'});
  assert.equal(storageValue(vm,pointer,'int&'),pointer);
});

test('a05-03: heap owner identity rejects foreign references even when h/g collide',()=>{
  const vm=context(),other=context(),local=vm.heap.object('Holder',[nested(vm,1)]),foreign=other.heap.object('Holder',[nested(other,2)]);
  assert.deepEqual(local,foreign);assert.equal(JSON.stringify(local),JSON.stringify(foreign));
  assert.throws(()=>vm.heap.get(foreign),{name:'InvalidReferenceException'});
  assert.throws(()=>address(vm,'field',0,foreign),{name:'InvalidReferenceException'});
  vm.top.locals[0]=foreign;vm.heap.collect();assert.throws(()=>vm.heap.get(local),{name:'InvalidReferenceException'});
  assert.throws(()=>copyValue(vm,nested(other,2)),{name:'InvalidProgramException'});
});

test('a05-03: aggregate snapshots retain immutable values and rewind nested writes',()=>{
  const vm=context(),owner=vm.heap.object('Holder',[nested(vm,4)]),pointer=numberPointer(vm,address(vm,'field',0,owner));
  vm.top.locals[0]=pointer;const snapshot=vm.heap.snapshot(),before=vm.heap.get(owner).data[0];
  assert.equal(copyExecution(before),before);assert.equal(copyExecution(pointer),pointer);
  dereference(vm,pointer,true,88);assert.equal(before.fields[0].fields[0],4);
  vm.heap.restore(snapshot);assert.equal(dereference(vm,pointer),4);
  dereference(vm,pointer,true,55);vm.heap.restore(snapshot);assert.equal(dereference(vm,pointer),4);
});

test('a05-03: parked scheduler locals root byrefs and cancellation expires stack refs',()=>{
  const compiled=compile('Console.WriteLine("ready");');assert.equal(compiled.success,true);
  const vm=new VirtualMachine(compiled.image);vm.heap.methodTables=tables();
  const ref=vm.heap.object('Holder',[nested(vm,5)]),interior=numberPointer(vm,address(vm,'field',0,ref));
  const frame={id:100,methodId:0,locals:[interior],stack:[],args:[]};
  vm.frames=[];vm.scheduler.enabled=true;vm.scheduler.parked=true;vm.scheduler.contexts.set(2,{id:2,status:'waiting',frames:[frame],stack:[]});
  const local=address(vm,'local',0,null,{frameId:100,type:'int&'});
  vm.heap.collect();assert.equal(dereference(vm,dereference(vm,local)),5);
  vm.scheduler.cancelAll();assert.throws(()=>dereference(vm,local),{name:'InvalidProgramException'});
  vm.heap.collect();assert.throws(()=>vm.heap.get(ref),{name:'InvalidReferenceException'});
});

test('a05-03: source IR adapters copy, address, and box explicit value types',()=>{
  const vm=context(),value=sourceValue(vm,'Inner',[3,null]);vm.top.locals[0]=sourceStorageValue(vm,value,'Inner');
  const local=address(vm,'local',0,null,{type:'Inner'});sourceFieldStore(vm,local,0,10);
  assert.equal(sourceFieldValue(vm,local,0),10);assert.equal(value.fields[0],3);
  const boxed=sourceStorageValue(vm,vm.top.locals[0],'object','Inner');assert.equal(vm.heap.get(boxed).methodTable.name,'Inner');
  const double=sourceStorageValue(vm,1,'object','double');assert.equal(vm.heap.get(double).methodTable.name,'System.Double');
});

test('a05-03 CIL: nested byref calls and GC preserve struct copies',()=>{
  const assembly=valueFixture([
    {name:'Main',result:'int',locals:['Fixture.Outer','Fixture.Outer'],body:(w,c)=>{
      w.op('ldloca.s',0).op('initobj',c.outer).op('ldloca.s',0).op('ldflda',c.nested).op('ldc.i4.7').op('stfld',c.number);
      w.op('ldloc.0').op('stloc.1').op('ldloca.s',1).op('ldflda',c.nested).op('ldflda',c.number).op('call',c.methods.Bump);
      w.op('ldloca.s',0).op('ldflda',c.nested).op('ldfld',c.number).op('ldc.i4',100).op('mul').op('ldloca.s',1).op('ldflda',c.nested).op('ldfld',c.number).op('add').op('ret');
    }},
    {name:'Bump',parameters:['int&'],body:(w,c)=>w.op('call',c.member('System.GC','Collect','void')).op('ldarg.0').op('ldarg.0').op('ldind.i4').op('ldc.i4.3').op('add').op('stind.i4').op('ret')}
  ]);
  const vm=new CilVirtualMachine(assembly),result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(vm.returnValue,710);
});

test('a05-03 CIL: cpobj and unbox.any copy while unbox aliases the original box',()=>{
  const assembly=valueFixture([{name:'Main',result:'int',locals:['Fixture.Outer','Fixture.Outer','object'],body:(w,c)=>{
    w.op('ldloca.s',0).op('initobj',c.outer).op('ldloca.s',0).op('ldflda',c.nested).op('ldc.i4.7').op('stfld',c.number);
    w.op('ldloca.s',1).op('ldloca.s',0).op('cpobj',c.outer).op('ldloc.1').op('box',c.outer).op('stloc.2');
    w.op('ldloc.2').op('unbox',c.outer).op('ldflda',c.nested).op('ldc.i4',12).op('stfld',c.number);
    w.op('ldloc.2').op('unbox.any',c.outer).op('stloc.0');
    w.op('ldloca.s',0).op('ldflda',c.nested).op('ldfld',c.number).op('ldloca.s',1).op('ldflda',c.nested).op('ldfld',c.number).op('add').op('ret');
  }}]);
  const vm=new CilVirtualMachine(assembly),result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(vm.returnValue,19);
});

test('a05-03 CIL: pointers returned to a dead local are rejected',()=>{
  const assembly=valueFixture([
    {name:'Main',result:'int',body:(w,c)=>w.op('call',c.methods.Escape).op('ldind.i4').op('ret')},
    {name:'Escape',result:'int&',locals:['int'],body:w=>w.op('ldc.i4.1').op('stloc.0').op('ldloca.s',0).op('ret')}
  ]);
  const result=new CilVirtualMachine(assembly).run();assert.equal(result.state,'faulted');assert.equal(result.fault.name,'InvalidProgramException');
});
