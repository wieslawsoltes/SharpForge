import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly,codedIndex,methodSignature,fieldSignature} from '@sharpforge/cil';
import {VirtualMachine,CilVirtualMachine,ManagedHeap} from '@sharpforge/runtime';
import {loadToken,typeFromHandle,objectType,typeEquals,typeName,typeHandle,typeProperty,runtimeTypeObject,runtimeTypeText,runtimeTypeRoots,clearRuntimeTypes} from '../packages/runtime/src/execution/tokens.js';
import {stringFromChars,referenceEquals} from '../packages/runtime/src/execution/strings.js';
import {copyExecution} from '../packages/runtime/src/snapshot.js';
import {MethodTableRegistry} from '../packages/runtime/src/execution/method-table.js';
import {managedFixture} from './managed-fixtures.js';

const compile=source=>{const result=compileToIL(source);assert(result.success,JSON.stringify(result.diagnostics));return result;};
const engines={source:compiled=>new VirtualMachine(compiled.image),reload:compiled=>new VirtualMachine(loadAssembly(compiled.assembly)),cil:compiled=>new CilVirtualMachine(compiled.assembly)};
const context=()=>{const vm={heap:new ManagedHeap(),snapshotOwner:Object.freeze({})};vm.heap.rootProvider=()=>runtimeTypeRoots(vm);return vm;};
const fixture=body=>managedFixture({methods:[{name:'Main',result:'void',body}]});

for(const [engine,make] of Object.entries(engines)) {
  test(`tokens ${engine}: GetType identity, names, and primitive static types`,()=>{
    const vm=make(compile(`class Item {} class Program { static void Main() {
      var a=new Item(); var b=new Item();
      Console.WriteLine(a.GetType()==b.GetType());
      Console.WriteLine(object.ReferenceEquals(a.GetType(),b.GetType()));
      Console.WriteLine(a.GetType().Name); Console.WriteLine(a.GetType().FullName);
      Console.WriteLine("text".GetType().FullName);
      int i=1; double d=1.0; bool flag=true;
      Console.WriteLine(i.GetType().Name); Console.WriteLine(d.GetType().Name); Console.WriteLine(flag.GetType().Name);
      Console.WriteLine(a.GetType().GetType().Name);
    }}
    `));
    const result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);
    assert.equal(result.output,'True\nTrue\nItem\nItem\nSystem.String\nInt32\nDouble\nBoolean\nRuntimeType\n');
  });
  test(`tokens ${engine}: cached Type roots, snapshot replay, and stop`,()=>{
    const vm=make(compile('Console.WriteLine("ready");'));
    vm.run();const first=runtimeTypeObject(vm,'string'),handle=typeHandle(vm,first),snapshot=vm.snapshot();
    assert.equal(copyExecution(handle),handle);
    vm.heap.collect();assert.equal(objectType(vm,first),runtimeTypeObject(vm,'System.RuntimeType'));
    const later=runtimeTypeObject(vm,'int');vm.restore(snapshot);
    assert.equal(runtimeTypeObject(vm,'System.String'),first);
    assert.equal(typeFromHandle(vm,handle),first);
    assert.equal(vm.typeObjects.has(vm.heap.methodTables.get('int')),false);
    assert.throws(()=>vm.heap.get(later),{name:'InvalidReferenceException'});
    vm.stop();assert.equal(vm.typeObjects.size,0);
    vm.heap.collect();assert.throws(()=>vm.heap.get(first),{name:'InvalidReferenceException'});
  });
  test(`tokens ${engine}: null GetType faults`,()=>{
    const result=make(compile('object value=null; Console.WriteLine(value.GetType());')).run();
    assert.equal(result.state,'faulted');assert.equal(result.fault.name,'NullReferenceException');
  });
}

test('tokens: aliases, closed/open generics, and array identity share stable tables',()=>{
  const vm=context(),open=runtimeTypeObject(vm,'List<>'),closed=runtimeTypeObject(vm,'List<int>'),other=runtimeTypeObject(vm,'List<string>');
  assert.equal(open,runtimeTypeObject(vm,'System.Collections.Generic.List`1'));
  assert.equal(closed,runtimeTypeObject(vm,'System.Collections.Generic.List`1<System.Int32>'));
  assert.equal(typeEquals(vm,open,closed),false);assert.equal(typeEquals(vm,closed,other),false);
  assert.equal(typeName(vm,closed),'List`1');assert.equal(typeName(vm,open,true),'System.Collections.Generic.List`1');
  assert.equal(typeName(vm,closed,true),'System.Collections.Generic.List`1[[System.Int32, System.Private.CoreLib, Version=8.0.0.0, Culture=neutral, PublicKeyToken=7cec85d7bea7798e]]');
  assert.equal(typeProperty(vm,open,'IsGenericTypeDefinition'),true);assert.equal(typeProperty(vm,closed,'IsGenericTypeDefinition'),false);
  assert.equal(typeProperty(vm,open,'ContainsGenericParameters'),true);assert.equal(typeProperty(vm,closed,'ContainsGenericParameters'),false);
  assert.equal(runtimeTypeText(vm,closed),'System.Collections.Generic.List`1[System.Int32]');
  assert.equal(typeName(vm,runtimeTypeObject(vm,'List<int>[]')),'List`1[]');
  assert.equal(runtimeTypeObject(vm,'int[]'),runtimeTypeObject(vm,'System.Int32[]'));
});

test('tokens: inherited object headers report actual type and boxed enum remains distinct',()=>{
  const tables=new MethodTableRegistry().define({name:'Base',base:'System.Object'}).define({name:'Derived',base:'Base'}).define({name:'Choice',base:'System.Enum',flags:{enum:true,valueType:true},enumUnderlyingType:'int'});
  const vm={heap:new ManagedHeap({methodTables:tables}),snapshotOwner:Object.freeze({})};vm.heap.rootProvider=()=>runtimeTypeRoots(vm);
  const value=vm.heap.object('Derived',[]),boxed=vm.heap.allocate('box','Choice',[1]);
  assert.equal(objectType(vm,value),runtimeTypeObject(vm,'Derived'));
  assert.equal(typeEquals(vm,objectType(vm,value),runtimeTypeObject(vm,'Base')),false);
  assert.equal(objectType(vm,boxed),runtimeTypeObject(vm,'Choice'));
  assert.equal(typeEquals(vm,objectType(vm,boxed),runtimeTypeObject(vm,'int')),false);
});

test('tokens: default handle, null comparisons, wrong kind, foreign and forged handles',()=>{
  const vm=context(),other=context(),type=runtimeTypeObject(vm,'int'),handle=typeHandle(vm,type);
  assert.equal(typeFromHandle(vm,null),null);assert.equal(typeEquals(vm,null,null),true);assert.equal(typeEquals(vm,null,type),false);
  assert.equal(typeEquals(vm,type,vm.heap.string('System.Int32')),false);
  assert.throws(()=>typeFromHandle(other,handle),{name:'ArgumentException'});
  assert.throws(()=>typeFromHandle(vm,{...handle}),{name:'ArgumentException'});
  assert.throws(()=>typeFromHandle(vm,Object.freeze({...handle,runtimeHandle:'method'})),{name:'ArgumentException'});
  assert.throws(()=>typeFromHandle(vm,Object.freeze({...handle,table:other.heap.methodTables.get('int')})),{name:'ArgumentException'});
  assert.throws(()=>objectType(vm,null),{name:'NullReferenceException'});
});

test('tokens: snapshots taken before the lazy Type cache discard subsequent entries',()=>{
  const vm=new VirtualMachine(compile('Console.WriteLine("ready");').image),snapshot=vm.snapshot();
  const ref=runtimeTypeObject(vm,'int');vm.restore(snapshot);
  assert.equal(Object.hasOwn(vm,'typeObjects'),false);
  assert.throws(()=>vm.heap.get(ref),{name:'InvalidReferenceException'});
});

test('tokens: ldtoken supports TypeDef/Ref/Spec and method/field definitions and references',()=>{
  let captured;
  const assembly=managedFixture({fields:[{name:'Value'}],methods:[{name:'Main',result:'void',body:(w,c)=>{
    const typeRef=c.resolve('System.String'),typeSpec=c.resolve('System.Collections.Generic.List`1<int>');
    const methodRef=c.md.member(c.type,'Main',methodSignature('void',[],true,c.resolve));
    const fieldRef=c.md.member(c.type,'Value',fieldSignature('int',c.resolve));
    const methodSpec=c.md.add(43,[codedIndex('MethodDefOrRef',c.methods.Generic),c.md.blob(Uint8Array.from([0x0a,1,0x08]))]);
    captured={type:c.type,typeRef,typeSpec,method:c.methods.Main,field:c.fields.Value,methodRef,fieldRef,methodSpec};
    for(const token of Object.values(captured))w.op('ldtoken',token).op('pop');w.op('ret');
  }},{name:'Generic',signature:Uint8Array.from([0x10,1,0,1]),result:'void',body:w=>w.op('ret')}],decorate:c=>c.md.add(42,[0,0,codedIndex('TypeOrMethodDef',c.methods.Generic),c.md.string('T')])});
  const vm=new CilVirtualMachine(assembly),result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);
  for(const [name,token] of Object.entries(captured)) {
    const handle=loadToken(vm,token),kind=name.startsWith('type')?'type':name.startsWith('method')?'method':'field';
    assert.equal(handle.runtimeHandle,kind);assert.equal(handle.owner,vm.snapshotOwner);assert.equal(Object.isFrozen(handle),true);
    assert.equal(copyExecution(handle),handle);
    if(kind==='type')assert.equal(typeFromHandle(vm,handle),runtimeTypeObject(vm,handle.table));
    else assert.throws(()=>typeFromHandle(vm,handle),{name:'ArgumentException'});
  }
  assert.equal(loadToken(vm,captured.method).token,loadToken(vm,captured.methodRef).token);
  assert.equal(loadToken(vm,captured.field).token,loadToken(vm,captured.fieldRef).token);
  assert.equal(loadToken(vm,captured.methodSpec).typeArguments[0],vm.heap.methodTables.get('int'));
  for(const token of [0,-1,0x0600ffff,0x100000000,1.5])assert.throws(()=>loadToken(vm,token),{name:'InvalidProgramException'});
  assert.throws(()=>loadToken(vm,0x20000001),{name:'InvalidProgramException'});
});

test('tokens CIL: typeof primitive, open generic and closed generic handles execute',()=>{
  const assembly=fixture((w,c)=>{
    const from=c.member('System.Type','GetTypeFromHandle','System.Type',['System.RuntimeTypeHandle']);
    const get=c.member('System.Object','GetType','System.Type',[],false),same=c.member('System.Type','op_Equality','bool',['System.Type','System.Type']);
    const write=c.member('System.Console','WriteLine','void',['bool']);
    w.op('ldtoken',c.resolve('System.String')).op('call',from).op('ldstr',0x70000000+c.md.userString('s')).op('callvirt',get).op('call',same).op('call',write);
    w.op('ldtoken',c.resolve('System.Int32')).op('call',from).op('ldc.i4.1').op('box',c.resolve('System.Int32')).op('callvirt',get).op('call',same).op('call',write);
    for(const type of ['System.Collections.Generic.List`1','System.Collections.Generic.List`1<int>']) {
      w.op('ldtoken',c.resolve(type)).op('call',from).op('ldtoken',c.resolve(type)).op('call',from).op('call',same).op('call',write);
    }
    w.op('ldtoken',c.resolve('System.Collections.Generic.List`1')).op('call',from).op('callvirt',c.member('System.Type','get_IsGenericTypeDefinition','bool',[],false)).op('call',write).op('ret');
  });
  const vm=new CilVirtualMachine(assembly),result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,'True\nTrue\nTrue\nTrue\nTrue\n');
});

test('strings: String(char[]) copies UTF-16 units, remains non-interned, and rejects invalid arrays',()=>{
  const vm=context(),chars=vm.heap.array('char',3);vm.heap.get(chars).data=[65,0xd83d,0xde00];
  const first=stringFromChars(vm,chars),second=stringFromChars(vm,chars);
  assert.equal(vm.heap.get(first).data,'A😀');assert.equal(referenceEquals(first,second),false);
  vm.heap.get(chars).data[0]=66;assert.equal(vm.heap.get(first).data,'A😀');
  assert.equal(vm.heap.get(stringFromChars(vm,null)).data,'');
  assert.throws(()=>stringFromChars(vm,vm.heap.array('int',0)),{name:'ArgumentException'});
});

test('strings CIL: String(char[]) constructor produces a fresh managed string',()=>{
  const assembly=managedFixture({methods:[{name:'Main',result:'string',body:(w,c)=>w.op('ldc.i4.1').op('newarr',c.resolve('System.Char')).op('dup').op('ldc.i4.0').op('ldc.i4',65).op('stelem.i2').op('newobj',c.member('System.String','.ctor','void',['char[]'],false)).op('ret')}]});
  const vm=new CilVirtualMachine(assembly),result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(vm.value(vm.returnValue),'A');
});
