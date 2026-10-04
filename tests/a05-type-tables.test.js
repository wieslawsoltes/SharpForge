import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap,CilVirtualMachine} from '@sharpforge/runtime';
import {MethodTableRegistry,createSourceMethodTables,runtimeTypeName} from '../packages/runtime/src/execution/method-table.js';
import {CilTypeSystem} from '../packages/runtime/src/execution/type-system.js';
import {copyExecution} from '../packages/runtime/src/snapshot.js';
import {namespaceAssembly} from './a05-type-fixtures.js';

test('A05 a generic interface first lookup retains identity through recursive primitive materialization',()=>{
  const registry=new MethodTableRegistry(),first=registry.get('System.IComparable`1<int>');
  assert.equal(first,registry.get('int').interfaces.find(table=>table.name==='System.IComparable`1<System.Int32>'));
});

test('A05 method tables retain canonical primitive, token and generic identities',()=>{
  const registry=new MethodTableRegistry({tokenResolver:token=>token===0x1b000001?'Box`1<int>':null});
  registry.define({name:'Box`1',token:0x02000001,fields:[{name:'Value',type:'!0',storageType:'!0'}]});
  assert.equal(registry.get('int'),registry.get('System.Int32'));
  assert.equal(registry.get(0x02000001),registry.get('Box`1'));
  const integer=registry.get('Box`1<int>'),text=registry.get('Box`1<string>');
  assert.equal(registry.get(0x1b000001),integer);
  assert.equal(integer.genericDefinition,registry.get('Box`1'));
  assert.equal(integer.definitionToken,0x02000001);
  assert.equal(integer.typeArguments[0],registry.get('int'));
  assert.equal(integer.fields[0].type,registry.get('int'));
  assert.equal(integer.fields[0].storageType,'System.Int32');
  assert.deepEqual(integer.gcBitmap,[false]);assert.deepEqual(text.gcBitmap,[true]);
  assert.notEqual(integer,text);assert.notEqual(integer.token,text.token);
  assert.equal(integer.containsGenericParameters,false);
  assert.equal(registry.get('Box`1<!0>').containsGenericParameters,true);
  assert.equal(registry.get('!0[]').containsGenericParameters,true);
  assert.equal(registry.get('List<>'),registry.get('System.Collections.Generic.List`1'));
  assert.equal(registry.get('List<int>'),registry.get('System.Collections.Generic.List`1<System.Int32>'));
  assert.equal(registry.get('int[1...10]'),registry.get('int[*]'));
  assert.equal(registry.get('int[1...10,0...5]'),registry.get('int[,]'));
  assert(Object.isFrozen(integer));assert(Object.isFrozen(integer.flags));assert(Object.isFrozen(integer.typeArguments));
});

test('A05 method tables describe inherited storage and interface implementation slots',()=>{
  const registry=new MethodTableRegistry();
  registry.define({name:'I',flags:{interface:true},vtable:[[101,101]]});
  registry.define({name:'Base',fields:[{name:'Reference',type:'object'}],interfaces:['I'],vtable:[[101,201]]});
  registry.define({name:'Derived',base:'Base',fields:[{name:'Count',type:'int'}],vtable:[[101,301]]});
  const base=registry.get('Base'),derived=registry.get('Derived'),iface=registry.get('I');
  assert.equal(derived.base,base);assert.deepEqual(derived.fields.map(field=>field.name),['Reference','Count']);
  assert.equal(derived.instanceSize,48);assert.deepEqual(derived.gcBitmap,[true,false]);
  assert.equal(base.interfaceMap.get(iface).get(101),201);
  assert.equal(derived.interfaceMap.get(iface).get(101),301);
  assert.equal(derived.vtable.get(101),301);
  assert.equal(registry.get('string').instanceSize,24);
  assert.deepEqual(registry.get('int[]').gcBitmap,[false]);
  assert.deepEqual(registry.get('object[]').gcBitmap,[true]);
});

test('A05 source image tables retain type and field identities across namespaces',()=>{
  const registry=createSourceMethodTables({types:[
    {id:0,name:'First.Widget',fields:[{name:'Number',type:'int',index:0}]},
    {id:1,name:'Second.Widget',fields:[{name:'Text',type:'string',index:0}]}
  ],methods:[{id:0,owner:'First.Widget',isStatic:false},{id:1,owner:'Second.Widget',isStatic:false},{id:2,owner:'First.Widget',isStatic:true}]});
  const first=registry.get('First.Widget'),second=registry.get('Second.Widget');
  assert.notEqual(first,second);assert.notEqual(first.token,second.token);
  assert.equal(first.vtable.get(0),0);assert.equal(first.vtable.has(2),false);assert.equal(second.vtable.get(1),1);
  assert.deepEqual(first.gcBitmap,[false]);assert.deepEqual(second.gcBitmap,[true]);
  const heap=new ManagedHeap({methodTables:registry});
  assert.equal(heap.get(heap.object(first,[10])).methodTable,first);
  assert.equal(heap.get(heap.object(second,[null])).methodTable,second);
  const frameworkEnum=registry.get('Microsoft.UI.Xaml.Visibility');
  assert.equal(frameworkEnum.flags.enum,true);assert.equal(frameworkEnum.enumUnderlyingType,registry.get('int'));
  assert.equal(frameworkEnum.base,registry.get('System.Enum'));
});

test('A05 heap headers survive collection, snapshots and metadata registry replacement',()=>{
  const heap=new ManagedHeap(),table=heap.methodTables.get('Example.Node');
  const child=heap.string('retained'),parent=heap.object(table,[child]),array=heap.array(heap.methodTables.get('int'),2),box=heap.allocate('box','int',[7]);
  assert.equal(heap.get(child).methodTable,heap.methodTables.get('string'));
  assert.equal(heap.get(parent).methodTable,table);
  assert.equal(heap.get(box).methodTable,heap.methodTables.get('int'));
  assert.equal(heap.get(array).methodTable.elementType,heap.methodTables.get('int'));
  assert(heap.get(array).data instanceof Int32Array);
  assert.deepEqual([...heap.get(array).data],[0,0]);
  const booleans=heap.get(heap.array('System.Boolean',1));
  assert(booleans.data instanceof Uint8Array);assert.deepEqual([...booleans.data],[0]);
  const longs=heap.get(heap.array('long',1));
  assert(longs.data instanceof BigInt64Array);assert.deepEqual([...longs.data],[0n]);
  const saved=heap.snapshot(),copied=copyExecution(saved);
  assert.equal(copied.records[parent.h].methodTable,table);
  heap.collect([parent,array,box]);assert.equal(heap.get(child).data,'retained');
  heap.restore(saved);assert.equal(heap.get(parent).methodTable,table);
  heap.methodTables=new MethodTableRegistry();heap.restore(saved);
  assert.equal(heap.get(parent).methodTable,heap.methodTables.get('Example.Node'));
  assert.notEqual(heap.get(parent).methodTable,table);
});

test('A05 recursive generic reference fields materialize without losing their closed identity',()=>{
  const registry=new MethodTableRegistry();
  registry.define({name:'Node`1',fields:[{name:'Next',type:'Node`1<!0>'},{name:'Value',type:'!0'}]});
  const table=registry.get('Node`1<string>');
  assert.equal(table.fields[0].type,table);assert.equal(table.fields[1].type,registry.get('string'));
  assert.deepEqual(table.gcBitmap,[true,true]);
});

test('A05 invalid method table definitions fail without retaining broken identities',()=>{
  const registry=new MethodTableRegistry();
  registry.define({name:'One',token:1});
  assert.throws(()=>registry.define({name:'Two',token:1}),/Duplicate method table token/);
  assert.equal(registry.descriptors.has('Two'),false);
  assert.throws(()=>registry.define({name:'One'}),/Duplicate method table/);
  registry.get('One');assert.throws(()=>registry.define({name:'One'}),/materialized/);
  assert.throws(()=>registry.get(987),/Unknown runtime type token/);
  assert.throws(()=>registry.get('List<int, string>'),/argument count/);
  assert.throws(()=>runtimeTypeName('List<int'),/Unbalanced/);
  assert.throws(()=>runtimeTypeName('int['),/Unbalanced/);
  registry.define({name:'A',base:'B'}).define({name:'B',base:'A'});
  assert.throws(()=>registry.get('A'),/Cyclic/);assert.equal(registry.tables.has('A'),false);assert.equal(registry.tables.has('B'),false);
  registry.define({name:'IA',flags:{interface:true},interfaces:['IB']}).define({name:'IB',flags:{interface:true},interfaces:['IA']});
  assert.throws(()=>registry.get('IA'),/Cyclic/);
});

test('A05 CIL headers distinguish namespaced virtual method declarations',()=>{
  const vm=new CilVirtualMachine(namespaceAssembly()),result=vm.run();
  assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.returnValue,12);
  const first=vm.typeSystem.table('First.Widget'),second=vm.typeSystem.table('Second.Widget');
  assert.notEqual(first,second);assert.equal(first.vtable.get(0x06000002),0x06000002);assert.equal(second.vtable.get(0x06000004),0x06000004);
  const firstObject=vm.heap.records.find(record=>record?.methodTable===first),secondObject=vm.heap.records.find(record=>record?.methodTable===second);
  assert(firstObject);assert(secondObject);
});

test('A05 CIL metadata tables preserve enum backing widths and rebuilt heap headers',()=>{
  const type={token:0x02000001,name:'Example.Tiny',baseToken:0x01000001,flags:0x101,interfaces:[],methods:[],fields:[{name:'value__',token:0x04000001,isStatic:false}]};
  const vm={heap:new ManagedHeap(),inspector:{types:[type],metadata:{rows:[],typeName:token=>token===type.token?type.name:'System.Enum'},signature:()=>({type:'byte'})}};
  const before=new CilTypeSystem(vm),ref=vm.heap.allocate('box',before.table(type.token),[255]),after=new CilTypeSystem(vm);
  assert.notEqual(before.table(type.token),after.table(type.token));
  assert.equal(vm.heap.get(ref).methodTable,after.table(type.token));
  assert.equal(after.typeOf(ref),type.token);assert.equal(after.table(type.token).enumUnderlyingType,after.table('byte'));
  assert.equal(after.table(type.token).flags.valueType,true);assert.equal(after.matches(ref,'System.Enum'),true);assert.equal(after.matches(ref,'byte'),false);
});

test('A05 CIL GenericParam variance and TypeSpec identities feed the same cast lattice',()=>{
  const covariant={token:0x02000001,name:'Example.ICov`1',baseToken:0,flags:0xa1,interfaces:[],methods:[],fields:[]};
  const contravariant={...covariant,token:0x02000002,name:'Example.IContra`1'};
  const names=new Map([[covariant.token,covariant.name],[contravariant.token,contravariant.name],[0x1b000001,'Example.ICov`1<string>'],[0x1b000002,'Example.ICov`1<object>']]);
  const rows=[];rows[42]=[[0,1,2,0],[0,2,4,0]];
  const vm={heap:new ManagedHeap(),inspector:{types:[covariant,contravariant],metadata:{rows,typeName:token=>names.get(token)}}};
  const system=new CilTypeSystem(vm);
  assert.deepEqual(system.table(covariant.token).variance,[1]);assert.deepEqual(system.table(contravariant.token).variance,[-1]);
  assert.equal(system.table(0x1b000001),system.table('Example.ICov`1<System.String>'));
  assert.equal(system.castCache.isAssignableFrom(0x1b000002,0x1b000001),true);
  assert.equal(system.castCache.isAssignableFrom('Example.IContra`1<string>','Example.IContra`1<object>'),true);
  assert.equal(system.castCache.isAssignableFrom('Example.ICov`1<object>','Example.ICov`1<int>'),false);
});
