import test from 'node:test';
import assert from 'node:assert/strict';
import {MetadataBuilder,Writer,CilWriter,methodSignature,fieldSignature,codedIndex,token,writePE,TEXT_RVA,verifyCilAssembly,resolveExecutionField} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {staticSlot} from '../packages/runtime/src/execution/statics.js';
import {managedFixture} from './managed-fixtures.js';

function genericFixture(body,{initializer=false,parameterField=false}={}) {
  const md=new MetadataBuilder('GenericStatics'),object=md.typeRef('System.Object'),generic=token(2,2),program=token(2,3),resolve=name=>md.typeRef(name);
  md.add(2,[0,md.string('<Module>'),0,0,1,1]);
  md.add(2,[0x100001,md.string('Counter`1'),0,codedIndex('TypeDefOrRef',object),1,1]);
  md.add(2,[0x100001,md.string('Program'),0,codedIndex('TypeDefOrRef',object),2,initializer?2:1]);
  md.add(42,[0,0,codedIndex('TypeOrMethodDef',generic),md.string('T')]);
  const field=md.add(4,[0x16,md.string('Value'),md.blob(parameterField?new Uint8Array([6,0x13,0]):fieldSignature('int',resolve))]);
  const closed=element=>md.add(27,[md.blob(new Writer().u8(0x15).u8(0x12).compressed(codedIndex('TypeDefOrRef',generic)).u8(1).u8(element).finish())]);
  const refs=[8,14].map(element=>md.member(closed(element),'Value',parameterField?new Uint8Array([6,0x13,0]):fieldSignature('int',resolve)));
  const definitions=[];
  if(initializer)definitions.push({name:'.cctor',result:'void',body:w=>w.op('ldc.i4',7).op('stsfld',field).op('ret')});
  definitions.push({name:'Main',result:parameterField?'void':'int',body:w=>body(w,{refs,field})});
  for(const method of definitions)md.add(6,[0,0,0x96,md.string(method.name),md.blob(methodSignature(method.result,[],true,resolve)),1]);
  const section=new Writer().zero(72);
  definitions.forEach((method,index)=>{const w=new CilWriter();method.body(w);const code=w.finish();section.pad(4);md.rows[6][index][0]=TEXT_RVA+section.length;section.u16(0x3013).u16(8).u32(code.length).u32(0).bytes(code);});
  section.pad(4);const offset=section.length,metadata=md.finish(undefined,new Uint8Array([3,7,0]));section.bytes(metadata);
  return {bytes:writePE(section.finish(),offset,metadata.length,token(6,definitions.length)),refs,field,generic,program};
}
function threadFixture(body) {
  return managedFixture({fields:[{name:'Value'}],methods:[{name:'Main',result:'int',body}],decorate:({md,fields,member})=>{
    md.add(12,[codedIndex('HasCustomAttribute',fields.Value),codedIndex('CustomAttributeType',member('System.ThreadStaticAttribute','.ctor','void',[],false)),md.blob(new Uint8Array([1,0,0,0]))]);
  }});
}
const execute=bytes=>{const vm=new CilVirtualMachine(bytes),result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);return {vm,result};};

test('A05 T26 closed generic types have distinct static slots and independent initializers',()=>{
  const {bytes}=genericFixture((w,{refs:[integer,string]})=>w.op('ldc.i4',42).op('stsfld',integer).op('ldsfld',string).op('ldsfld',integer).op('add').op('ret'),{initializer:true});
  const {vm,result}=execute(bytes);assert.equal(result.returnValue,49);
  assert.equal([...vm.initialized.values()].filter(state=>state.genericIdentity).length,2);
});
test('A05 T26 generic field signatures substitute the declaring type arguments',()=>{
  const {bytes,refs}=genericFixture(w=>w.op('ret'),{parameterField:true}),vm=new CilVirtualMachine(bytes);
  assert.equal(resolveExecutionField(vm.inspector,refs[0]).signature.type,'int');
  assert.equal(resolveExecutionField(vm.inspector,refs[1]).signature.type,'string');
  assert.equal(staticSlot(vm,refs[0]).field.owner,'Counter`1');
});
test('A05 T26 ldsflda retains its closed generic identity',()=>{
  const {bytes}=genericFixture((w,{refs:[integer,string]})=>w.op('ldsflda',integer).op('ldc.i4',37).op('stind.i4').op('ldsfld',string).op('ldsfld',integer).op('add').op('ret'));
  assert.equal(execute(bytes).result.returnValue,37);
});
test('A05 T26 ThreadStatic defaults and writes are isolated by scheduler context',()=>{
  const bytes=threadFixture((w,c)=>w.op('ldsfld',c.fields.Value).op('ret')),vm=new CilVirtualMachine(bytes),field=[...vm.inspector.fields.keys()][0];
  const first=staticSlot(vm,field);vm.statics.set(first.key,42);
  vm.scheduler.currentId=2;const second=staticSlot(vm,field);assert.notEqual(second.key,first.key);assert.equal(vm.statics.get(second.key),0);
  vm.statics.set(second.key,17);vm.scheduler.currentId=1;assert.equal(vm.run().returnValue,42);
});
test('A05 T26 ThreadStatic addresses preserve their original context across switches',()=>{
  const bytes=threadFixture((w,c)=>w.op('ldsfld',c.fields.Value).op('ret')),vm=new CilVirtualMachine(bytes),field=[...vm.inspector.fields.keys()][0];
  const first=staticSlot(vm,field),address=vm.address('static',first.key);vm.scheduler.currentId=2;
  const second=staticSlot(vm,field);vm.dereference(address,true,31);
  assert.equal(vm.statics.get(first.key),31);assert.equal(vm.statics.get(second.key),0);
});
test('A05 T26 closed generic static references remain rooted and restore with snapshots',()=>{
  const {bytes,refs}=genericFixture(w=>w.op('ret'),{parameterField:true}),vm=new CilVirtualMachine(bytes),slot=staticSlot(vm,refs[1]);
  const value=vm.heap.string('retained');vm.statics.set(slot.key,value);vm.heap.collect();assert.equal(vm.value(value),'retained');
  const snapshot=vm.snapshot();vm.statics.set(slot.key,null);vm.restore(snapshot);assert.equal(vm.value(vm.statics.get(slot.key)),'retained');
});
test('A05 T26 volatile field and indirect accesses execute in instruction order',()=>{
  const bytes=managedFixture({fields:[{name:'Value'}],methods:[{name:'Main',result:'int',body:(w,c)=>w.op('ldc.i4',42).op('volatile.').op('stsfld',c.fields.Value).op('ldsflda',c.fields.Value).op('volatile.').op('ldind.i4').op('ret')}],decorate:({md,fields})=>{
    md.rows[4][(fields.Value&0xffffff)-1][2]=md.blob(new Writer().u8(6).u8(0x1f).compressed(codedIndex('TypeDefOrRef',md.typeRef('System.Runtime.CompilerServices.IsVolatile'))).u8(8).finish());
  }});
  assert.equal(execute(bytes).result.returnValue,42);
});
test('A05 T26 verifier rejects malformed volatile prefixes and branches that split prefixes',()=>{
  for(const body of [w=>w.op('volatile.').op('ldc.i4',1).op('ret'),(w,c)=>w.op('br','load').op('volatile.').mark('load').op('ldsfld',c.fields.Value).op('ret')]) {
    const report=verifyCilAssembly(managedFixture({fields:[{name:'Value'}],methods:[{name:'Main',result:'int',body}]}));
    assert.equal(report.success,false);assert(report.issues.some(issue=>issue.code==='IL_PREFIX'));
  }
});

test('A05 T26 interleaved cooperative workers retain independent ThreadStatic values',()=>{
  const bytes=managedFixture({fields:[{name:'Value'}],methods:[
    {name:'Main',result:'void',body:(w,c)=>w.op('ldftn',c.methods.Worker).op('pop').op('ret')},
    {name:'Worker',result:'int',parameters:['int'],body:(w,c)=>w.op('ldarg.0').op('stsfld',c.fields.Value).op('nop').op('ldsfld',c.fields.Value).op('ret')}
  ],decorate:({md,fields,member})=>md.add(12,[codedIndex('HasCustomAttribute',fields.Value),codedIndex('CustomAttributeType',member('System.ThreadStaticAttribute','.ctor','void',[],false)),md.blob(new Uint8Array([1,0,0,0]))])});
  const vm=new CilVirtualMachine(bytes,{schedulerQuantum:1}),worker=[...vm.inspector.methods.values()].find(method=>method.name==='Worker');
  const delegate=vm.platform.delegate('System.Func`2<int, int>',worker.token,null),first=vm.scheduler.createTask('int'),second=vm.scheduler.createTask('int');
  vm.scheduler.enqueue(delegate,[42],{task:first});vm.scheduler.enqueue(delegate,[17],{task:second});
  const result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);
  assert.equal(first.result,42);assert.equal(second.result,17);assert.equal(first.status,'completed');assert.equal(second.status,'completed');
});
