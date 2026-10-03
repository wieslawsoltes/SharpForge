import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap,CilVirtualMachine} from '@sharpforge/runtime';
import {MethodTableRegistry} from '../packages/runtime/src/execution/method-table.js';
import {createArray,arrayRecord,arrayShape,validateArrayShape,arrayOffset,arrayDimension,arrayGet,arraySet,arrayAddress,arrayVectorRecord,sourceArrayCreate,sourceArrayGet,sourceArraySet} from '../packages/runtime/src/execution/arrays.js';
import {arrayCall} from '../packages/runtime/src/execution/array-calls.js';
import {arrayMethodDefinition} from '../packages/cil/src/array-profile.js';
import {createValue,boxValue,unboxValue} from '../packages/runtime/src/execution/value-types.js';
import {address,dereference} from '../packages/runtime/src/execution/managed-pointers.js';
import {runtimeTypeObject} from '../packages/runtime/src/execution/tokens.js';
import {castCacheFor} from '../packages/runtime/src/execution/casting.js';
import {arrayFixture} from './a05-05-fixtures.js';

function context() {
  const registry=new MethodTableRegistry().define({name:'Pair',base:'System.ValueType',flags:{valueType:true},fields:[{name:'Number',type:'int'},{name:'Text',type:'string'}]})
    .define({name:'Choice',base:'System.Enum',flags:{valueType:true,enum:true},enumUnderlyingType:'int'});
  const vm={heap:new ManagedHeap({methodTables:registry}),snapshotOwner:Object.freeze({}),frames:[{id:1,locals:[]}],options:{},statics:new Map()};
  Object.defineProperty(vm,'top',{get:()=>vm.frames.at(-1)});vm.heap.rootProvider=()=>vm.frames.flatMap(frame=>frame.locals);return vm;
}
const descriptor=(owner,name,parameters,returnType='void',isStatic=false)=>({kind:'method',owner,name,signature:{parameters,returnType,isStatic,genericArity:0,callingConvention:0}});
const reflect=(vm,name,parameters,args,result='int',isStatic=false)=>arrayCall(vm,descriptor('System.Array',name,parameters,result,isStatic),args).value;

test('a05-05: rectangular arrays preserve rank, row-major order, and dimension bounds',()=>{
  const vm=context(),ref=createArray(vm,'int',[2,3],[-2,5]),record=arrayRecord(vm,ref);
  assert.equal(record.methodTable.name,'System.Int32[,]');assert.equal(arrayShape(record).rank,2);
  let n=1;for(let row=-2;row<0;row++)for(let col=5;col<8;col++)arraySet(vm,ref,[row,col],n++);
  assert.deepEqual(record.data,[1,2,3,4,5,6]);assert.equal(arrayGet(vm,ref,[-1,7]),6);
  assert.equal(arrayDimension(vm,ref,0,'lower'),-2);assert.equal(arrayDimension(vm,ref,1,'upper'),7);
  assert.equal(arrayOffset(record,[-1,6]),4);
  assert.throws(()=>arrayGet(vm,ref,[0,5]),{name:'IndexOutOfRangeException'});
  assert.throws(()=>arrayGet(vm,ref,[-2,8]),{name:'IndexOutOfRangeException'});
  assert.throws(()=>arrayDimension(vm,ref,2),{name:'IndexOutOfRangeException'});
  assert.throws(()=>arrayVectorRecord(vm,ref,0),{name:'InvalidProgramException'});
});

test('a05-05: rank-one zero bounds become vectors, nonzero bounds keep ARRAY identity',()=>{
  const vm=context(),vector=createArray(vm,'string',[2],[0]),bounded=createArray(vm,'string',[2],[-1]);
  assert.equal(arrayRecord(vm,vector).methodTable.name,'System.String[]');assert.equal(arrayRecord(vm,bounded).methodTable.name,'System.String[*]');
  const casts=castCacheFor(vm.heap.methodTables);
  assert.equal(casts.isAssignableFrom('object[*]',arrayRecord(vm,bounded).methodTable),true);
  assert.equal(casts.isAssignableFrom('object[]',arrayRecord(vm,bounded).methodTable),false);
  assert.equal(arrayGet(vm,bounded,[-1]),null);
});

test('a05-05: zero sizes, rank32, signed boundaries, overflow, and allocation limits',()=>{
  const vm=context(),empty=createArray(vm,'int',[2,0],[0,7]);
  assert.equal(arrayRecord(vm,empty).data.length,0);assert.equal(arrayDimension(vm,empty,1,'upper'),6);
  assert.throws(()=>arrayGet(vm,empty,[0,7]),{name:'IndexOutOfRangeException'});
  const high=createArray(vm,'int',[1],[2147483647]);assert.equal(arrayGet(vm,high,[2147483647]),0);
  const low=createArray(vm,'int',[0],[-2147483648]);assert.equal(arrayDimension(vm,low,0,'upper'),2147483647);
  assert.equal(arrayShape(arrayRecord(vm,createArray(vm,'int',Array(32).fill(1)))).rank,32);
  assert.throws(()=>createArray(vm,'int',Array(33).fill(1)),{name:'TypeLoadException'});
  assert.throws(()=>createArray(vm,'int',[]),{name:'ArgumentException'});
  assert.throws(()=>createArray(vm,'int',[1,2],[0]),{name:'ArgumentException'});
  assert.throws(()=>createArray(vm,'int',[-1]),{name:'OverflowException'});
  assert.throws(()=>createArray(vm,'int',[-1],null,{reflection:true}),{name:'ArgumentOutOfRangeException'});
  assert.throws(()=>createArray(vm,'int',[2],[2147483647]),{name:'ArgumentOutOfRangeException'});
  assert.throws(()=>createArray(vm,'int',[1001,1000]),{name:'OutOfMemoryException'});
  assert.throws(()=>createArray(vm,'int',[0,1000001]),{name:'OutOfMemoryException'});
  assert.throws(()=>createArray(vm,'void',[1]),{name:'NotSupportedException'});
  assert.throws(()=>createArray(vm,'List<>',[1]),{name:'NotSupportedException'});
});

test('a05-05: covariance checks actual elements and writable addresses',()=>{
  const vm=context(),ref=createArray(vm,'string',[1,1]),text=vm.heap.string('ok'),other=vm.heap.object('object',[]);
  assert.equal(castCacheFor(vm.heap.methodTables).isAssignableFrom('object[,]',arrayRecord(vm,ref).methodTable),true);
  arraySet(vm,ref,[0,0],text);assert.equal(arrayGet(vm,ref,[0,0]),text);
  assert.throws(()=>arraySet(vm,ref,[0,0],other),{name:'ArrayTypeMismatchException'});
  assert.throws(()=>arrayAddress(vm,ref,[0,0],{type:'object'}),{name:'ArrayTypeMismatchException'});
  const readonly=arrayAddress(vm,ref,[0,0],{type:'object',readonly:true});assert.equal(dereference(vm,readonly),text);
  assert.throws(()=>dereference(vm,readonly,true,null),{name:'InvalidProgramException'});
  assert.throws(()=>arrayGet(vm,null,[0]),{name:'NullReferenceException'});
});

test('a05-05: struct array copies and interior references survive collection and snapshots',()=>{
  const vm=context(),ref=createArray(vm,'Pair',[2,2]),text=vm.heap.string('rooted');
  arraySet(vm,ref,[1,0],createValue(vm,'Pair',[7,text]));
  const copy=arrayGet(vm,ref,[1,0]),pointer=address(vm,'field',0,arrayAddress(vm,ref,[1,0]));vm.top.locals=[pointer];
  const snapshot=vm.heap.snapshot();vm.heap.collect();assert.equal(vm.heap.get(text).data,'rooted');
  dereference(vm,pointer,true,9);assert.equal(copy.fields[0],7);assert.equal(arrayGet(vm,ref,[1,0]).fields[0],9);
  assert.equal(arrayGet(vm,ref,[0,0]).fields[0],0);vm.heap.restore(snapshot);assert.equal(dereference(vm,pointer),7);
  assert.equal(Object.isFrozen(arrayShape(arrayRecord(vm,ref)).lengths),true);
  vm.frames=[];vm.heap.collect();assert.throws(()=>dereference(vm,pointer),{name:'InvalidReferenceException'});
});

test('a05-05: reflection boxes values, widens primitives, resets null, and reports native store faults',()=>{
  const vm=context(),ref=createArray(vm,'long',[1,1]);
  arraySet(vm,ref,[0,0],boxValue(vm,7,'int'),{reflection:true});
  assert.equal(unboxValue(vm,arrayGet(vm,ref,[0,0],{reflection:true}),'long'),7n);
  arraySet(vm,ref,[0,0],null,{reflection:true});assert.equal(arrayGet(vm,ref,[0,0]),0n);
  assert.throws(()=>arraySet(vm,ref,[0,0],boxValue(vm,1,'double'),{reflection:true}),{name:'ArgumentException'});
  assert.throws(()=>arraySet(vm,ref,[0,0],vm.heap.string('bad'),{reflection:true}),{name:'InvalidCastException'});
  const strings=createArray(vm,'string',[1,1]);
  assert.throws(()=>arraySet(vm,strings,[0,0],boxValue(vm,1,'int'),{reflection:true}),{name:'InvalidCastException'});
  assert.throws(()=>arrayGet(vm,ref,[0],{reflection:true}),{name:'ArgumentException'});
  const enums=createArray(vm,'Choice',[1,1]);arraySet(vm,enums,[0,0],boxValue(vm,2,'Choice'),{reflection:true});
  assert.equal(arrayGet(vm,enums,[0,0]),2);
  assert.throws(()=>arraySet(vm,enums,[0,0],boxValue(vm,2,'int'),{reflection:true}),{name:'InvalidCastException'});
  arraySet(vm,ref,[0,0],boxValue(vm,2,'Choice'),{reflection:true});assert.equal(arrayGet(vm,ref,[0,0]),2n);
});

test('a05-05: Array CreateInstance and dimension reflection hooks accept managed vectors',()=>{
  const vm=context(),type=runtimeTypeObject(vm,'int'),lengths=vm.heap.array('int',2),bounds=vm.heap.array('int',2);
  vm.heap.get(lengths).data=[2,3];vm.heap.get(bounds).data=[-1,4];
  const ref=reflect(vm,'CreateInstance',['System.Type','int[]','int[]'],[type,lengths,bounds],'System.Array',true);
  assert.equal(reflect(vm,'get_Rank',[],[ref]),2);assert.equal(reflect(vm,'get_Length',[],[ref]),6);
  assert.equal(reflect(vm,'get_LongLength',[],[ref],'long'),6n);assert.equal(reflect(vm,'GetLowerBound',['int'],[ref,0]),-1);
  reflect(vm,'SetValue',['object','int','int'],[ref,boxValue(vm,17,'int'),0,6],'void');
  assert.equal(unboxValue(vm,reflect(vm,'GetValue',['long','long'],[ref,0n,6n],'object'),'int'),17);
  assert.throws(()=>reflect(vm,'CreateInstance',['System.Type','int[]'],[type,null],'System.Array',true),{name:'ArgumentNullException'});
  assert.throws(()=>reflect(vm,'CreateInstance',['System.Type','int[]'],[type,vm.heap.array('long',2)],'System.Array',true),{name:'ArgumentException'});
  assert.throws(()=>reflect(vm,'GetValue',['long','long'],[ref,0n,2147483648n],'object'),{name:'ArgumentOutOfRangeException'});
});

test('a05-05: snapshot shape validation rejects forged strides, rank and length while accepting empty shapes',()=>{
  const vm=context(),record=arrayRecord(vm,createArray(vm,'int',[2,3],[-1,5]));
  validateArrayShape(record);
  for(const patch of [{rank:1},{strides:[1,2]},{lengths:[2,2]},{lowerBounds:[0,2147483647]},{szArray:true}])
    assert.throws(()=>validateArrayShape({...record,arrayShape:{...record.arrayShape,...patch}}),TypeError);
  validateArrayShape(arrayRecord(vm,createArray(vm,'int',[0,1000000,1000000,1000000])));
  assert.throws(()=>validateArrayShape({...record,arrayShape:undefined}),TypeError);
});

test('a05-05: descriptor admission checks full pseudo-method signatures and malformed calls',()=>{
  const vm=context(),ctor=descriptor('int[,]','.ctor',['int','int']);
  const ref=arrayCall(vm,ctor,[2,3],'newobj').value;
  assert.equal(arrayMethodDefinition(ctor).operation,'construct');
  for(const invalid of [descriptor('int[,]','Get',['int'],'int'),descriptor('int[,]','Get',['int','int'],'long'),descriptor('int[,]','Set',['int','int','long']),descriptor('int[]','Get',['int'],'int'),{...ctor,kind:'field'}])assert.equal(arrayMethodDefinition(invalid),null);
  assert.throws(()=>arrayCall(vm,ctor,[2,3]),{name:'InvalidProgramException'});
  const store=descriptor('int[,]','Set',['int','int','int']);arrayCall(vm,store,[ref,1,2,25]);
  assert.equal(arrayCall(vm,descriptor('int[,]','Get',['int','int'],'int'),[ref,1,2]).value,25);
  assert.throws(()=>arrayCall(vm,descriptor('int[,,]','Get',['int','int','int'],'int'),[ref,0,0,0]),{name:'InvalidProgramException'});
  const other=context();assert.throws(()=>arrayGet(other,ref,[0,0]),{name:'InvalidReferenceException'});
});

test('a05-05: source IR shares rank, typed stores, and lower-bound semantics',()=>{
  const vm=context(),ref=sourceArrayCreate(vm,'int',[2,2],[1,-1]);
  sourceArraySet(vm,ref,[2,0],42);assert.equal(sourceArrayGet(vm,ref,[2,0]),42);
  assert.throws(()=>sourceArrayGet(vm,ref,[0,0]),{name:'IndexOutOfRangeException'});
});

test('a05-05 CIL: ARRAY constructors, Get/Set, Address, and GC execute independently authored metadata',()=>{
  const bytes=arrayFixture((w,c)=>{
    w.op('ldc.i4.2').op('ldc.i4.3').op('newobj',c.ctor).op('stloc.0');
    w.op('ldloc.0').op('ldc.i4.1').op('ldc.i4.2').op('ldc.i4',17).op('call',c.set);
    w.op('ldloc.0').op('ldc.i4.1').op('ldc.i4.2').op('call',c.address).op('stloc.1');
    w.op('call',c.collect).op('ldloc.1').op('ldc.i4',42).op('stind.i4');
    w.op('ldloc.0').op('ldc.i4.1').op('ldc.i4.2').op('call',c.get).op('ret');
  });
  const vm=new CilVirtualMachine(bytes),result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(vm.returnValue,42);
});

test('a05-05 CIL: lower-bound constructor uses interleaved bound/length parameters',()=>{
  const bytes=arrayFixture((w,c)=>{
    w.op('ldc.i4.m1').op('ldc.i4.2').op('ldc.i4.4').op('ldc.i4.3').op('newobj',c.boundedCtor).op('stloc.0');
    w.op('ldloc.0').op('ldc.i4.0').op('ldc.i4.6').op('ldc.i4',33).op('call',c.set);
    w.op('ldloc.0').op('ldc.i4.0').op('ldc.i4.6').op('call',c.get).op('ret');
  });
  const vm=new CilVirtualMachine(bytes),result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(vm.returnValue,33);
});
