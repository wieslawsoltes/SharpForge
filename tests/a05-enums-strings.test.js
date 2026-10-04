import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {BuiltinMap} from '@sharpforge/bytecode';
import {CilVirtualMachine,VirtualMachine,ManagedHeap} from '@sharpforge/runtime';
import {StringInternPool,literalString,internString,isInternedString,referenceEquals,stringChar} from '../packages/runtime/src/execution/strings.js';
import {enumInfo,enumValue,enumUnderlying,enumToString,enumHasFlag} from '../packages/runtime/src/execution/enums.js';
import {enumFixture} from './a05-enum-fixtures.js';
import {managedFixture} from './managed-fixtures.js';

const paths={source:c=>new VirtualMachine(c.image),reload:c=>new VirtualMachine(loadAssembly(c.assembly)),cil:c=>new CilVirtualMachine(c.assembly)};
const compile=source=>{const result=compileToIL(source);assert(result.success,JSON.stringify(result.diagnostics));return result;};

for(const [engine,make] of Object.entries(paths)) {
  test(`enums ${engine}: explicit numeric and enum casts preserve identity and checked boundaries`,()=>{
    const result=make(compile(`using Microsoft.UI.Xaml;
      int one=1; double unknown=9.9;
      Visibility value=(Visibility)one;
      Console.WriteLine(value);
      Console.WriteLine((Visibility)1);
      Console.WriteLine((Microsoft.UI.Xaml.Visibility)0);
      Console.WriteLine((one) + 1);
      Console.WriteLine((int)value);
      Console.WriteLine((double)value);
      Console.WriteLine((Orientation)value);
      Console.WriteLine((Visibility)unknown);
      Console.WriteLine((int)(Visibility)(-2147483647-1));
      Console.WriteLine((int)checked((Visibility)one));
      double huge=1e30;
      try { Console.WriteLine(checked((Visibility)huge)); }
      catch(Exception e) { Console.WriteLine("overflow"); }`)).run();
    assert.equal(result.state,'terminated',result.fault?.stack);
    assert.equal(result.output,'Collapsed\nCollapsed\nVisible\n2\n1\n1\nHorizontal\n9\n-2147483648\n1\noverflow\n');
  });
  test(`strings ${engine}: literal identity, runtime allocation, and explicit interning`,()=>{
    const compiled=compile(`string a="a"; string b="ab".Substring(0,1);
      Console.WriteLine(object.ReferenceEquals(a,"a"));
      Console.WriteLine(object.ReferenceEquals(a,b));
      Console.WriteLine(object.ReferenceEquals(a,string.IsInterned(b)));
      Console.WriteLine(object.ReferenceEquals(a,string.Intern(b)));
      string c="different".Substring(0,4);
      Console.WriteLine(string.IsInterned(c)==null);
      Console.WriteLine(object.ReferenceEquals(c,string.Intern(c)));
      Console.WriteLine(object.ReferenceEquals(null,null));`);
    const result=make(compiled).run();
    assert.equal(result.state,'terminated',result.fault?.stack);
    assert.equal(result.output,'True\nFalse\nTrue\nTrue\nTrue\nTrue\nTrue\n');
  });
  test(`strings ${engine}: pool snapshot replay and stop release managed roots`,()=>{
    const vm=make(compile('Console.WriteLine("persistent");'));
    vm.run();const ref=literalString(vm,'persistent'),snapshot=vm.snapshot();
    vm.heap.collect();assert.equal(vm.heap.get(ref).data,'persistent');
    literalString(vm,'later');vm.restore(snapshot);
    assert.equal(literalString(vm,'persistent'),ref);
    assert.equal(vm.strings.has('later'),false);
    vm.stop();assert.equal(vm.strings.size,0);
    vm.heap.collect();assert.throws(()=>vm.heap.get(ref),{name:'InvalidReferenceException'});
  });
  test(`enums ${engine}: framework enum locals and boxing retain names and HasFlag`,()=>{
    const result=make(compile(`using Microsoft.UI.Xaml;
      var value=Visibility.Collapsed;
      Console.WriteLine(value);
      object boxed=value;
      Console.WriteLine(boxed);
      Console.WriteLine(value.ToString());
      Console.WriteLine(value.HasFlag(Visibility.Collapsed));
      Console.WriteLine(value.HasFlag(Visibility.Visible));`)).run();
    assert.equal(result.state,'terminated',result.fault?.stack);
    assert.equal(result.output,'Collapsed\nCollapsed\nCollapsed\nTrue\nTrue\n');
  });
}

test('strings: weak pools drop collected handles and reject handles reused for another object',()=>{
  const heap=new ManagedHeap(),pool=new StringInternPool(heap,new Map(),{weak:true});
  heap.rootProvider=()=>pool.roots();const original=pool.literal('weak');
  heap.collect();const unrelated=heap.string('other');
  assert.equal(unrelated.h,original.h);
  assert.notEqual(unrelated.g,original.g);
  assert.throws(()=>heap.get(original),{name:'InvalidReferenceException'});
  assert.equal(pool.find('weak'),null);
  const next=pool.literal('weak');
  // Generations are per slot: a new slot may start at the same generation as the stale slot.
  assert.equal(referenceEquals(next,original),false);
  assert.equal(referenceEquals(next,unrelated),false);
  assert.throws(()=>heap.get(original),{name:'InvalidReferenceException'});
  assert.equal(heap.get(unrelated).data,'other');
  assert.equal(heap.get(next).data,'weak');
});
test('strings: weak VM pools remain snapshotable without host WeakRefs',()=>{
  const compiled=compile('Console.WriteLine("value");');
  for(const vm of [new VirtualMachine(compiled.image,{weakStringInterning:true}),new CilVirtualMachine(compiled.assembly,{weakStringInterning:true})]) {
    const ref=literalString(vm,'unrooted'),saved=vm.snapshot();
    vm.heap.collect();assert.throws(()=>vm.heap.get(ref),{name:'InvalidReferenceException'});
    vm.restore(saved);assert.equal(literalString(vm,'unrooted'),ref);
  }
});
test('strings: intern rejects null and non-string references without growing the pool',()=>{
  const vm={heap:new ManagedHeap(),strings:new Map(),options:{}};
  for(const operation of [internString,isInternedString]) {
    assert.throws(()=>operation(vm,null),{name:'ArgumentNullException'});
    assert.throws(()=>operation(vm,vm.heap.object('N',[])),{name:'ArgumentException'});
  }
  assert.equal(vm.strings.size,0);
  assert.equal(referenceEquals(null,null),true);
  assert.equal(referenceEquals(1,1),false);
});
test('strings: character indexing exposes exact UTF-16 code units in both intrinsic paths',()=>{
  const compiled=compile('Console.WriteLine(0);');
  for(const vm of [new VirtualMachine(compiled.image),new CilVirtualMachine(compiled.assembly)]) {
    const ref=vm.heap.string('A😀\ud800');
    for(const [index,code] of [65,0xd83d,0xde00,0xd800].entries()) {
      assert.equal(stringChar(vm,ref,index),code);
      const result=vm instanceof VirtualMachine?vm.builtin(BuiltinMap.get('string.get_Chars').id,[ref,index]):vm.intrinsic({kind:'method',owner:'System.String',name:'get_Chars',signature:{isStatic:false,parameters:['int'],returnType:'char'}},[ref,index]);
      assert.equal(result,code);
    }
    for(const index of [-1,4,0.5])assert.throws(()=>stringChar(vm,ref,index),{name:'IndexOutOfRangeException'});
    assert.throws(()=>stringChar(vm,null,0),{name:'NullReferenceException'});
  }
});

test('enums: source Op.ENUM preserves type while numeric conversions use underlying storage',()=>{
  const vm=new VirtualMachine(compile('Console.WriteLine(0);').image);
  const a=enumValue(vm,'Microsoft.UI.Xaml.Visibility',1),b=enumValue(vm,'Microsoft.UI.Xaml.Orientation',1);
  assert.equal(a.enumType,'Microsoft.UI.Xaml.Visibility');assert.equal(vm.value(a),1);
  assert.equal(vm.format(a),'Collapsed');assert.equal(vm.format(b),'Horizontal');
  assert.throws(()=>enumHasFlag(vm,a,b),{name:'ArgumentException'});
  assert.throws(()=>enumHasFlag(vm,a,null),{name:'ArgumentNullException'});
  assert.equal(enumToString(vm,enumValue(vm,a.enumType,9)),'9');
  assert.equal(vm.binary('+',a,2,1),3);
});
test('enums: underlying signed and unsigned widths preserve boundary values',()=>{
  assert.equal(enumUnderlying(255,'sbyte'),-1);
  assert.equal(enumUnderlying(-1,'byte'),255);
  assert.equal(enumUnderlying(-1,'uint'),4294967295);
  assert.equal(enumUnderlying(9223372036854775808n,'long'),-9223372036854775808n);
  assert.equal(enumUnderlying(-1n,'ulong'),18446744073709551615n);
  assert.throws(()=>enumUnderlying(0.5),{name:'InvalidProgramException'});
});
test('enums CIL: independently authored boxed enum names and runtime type identity',()=>{
  const assembly=enumFixture({locals:['object'],body:(w,c)=>{
    const writeString=c.member('System.Console','WriteLine','void',['string']),writeBool=c.member('System.Console','WriteLine','void',['bool']);
    w.op('ldc.i4.1').op('box',c.enumToken).op('stloc.0');
    w.op('ldloc.0').op('callvirt',c.member('System.Enum','ToString','string',[],false)).op('call',writeString);
    for(const type of [c.enumToken,c.md.typeRef('System.Enum'),c.md.typeRef('System.Int32')])w.op('ldloc.0').op('isinst',type).op('ldnull').op('cgt.un').op('call',writeBool);
    w.op('ldloc.0').op('ldc.i4.1').op('box',c.enumToken).op('callvirt',c.member('System.Enum','HasFlag','bool',['System.Enum'],false)).op('call',writeBool).op('ret');
  }});
  const vm=new CilVirtualMachine(assembly),result=vm.run();
  assert.equal(result.state,'terminated',result.fault?.stack);
  assert.equal(result.output,'A\nTrue\nTrue\nFalse\nTrue\n');
});
test('enums CIL: flags names, unknown values, zero and unsigned metadata boundaries',()=>{
  const vm=new CilVirtualMachine(enumFixture({flags:true,underlying:'uint',members:[['None',0],['A',1],['B',2],['High',2147483648]],body:w=>w.op('ret')}));
  assert.equal(enumInfo(vm,'Fixture.Choice').underlyingType,'uint');
  for(const [value,expected] of [[0,'None'],[3,'A, B'],[4,'4'],[2147483648,'High'],[2147483649,'A, High']])assert.equal(enumToString(vm,enumValue(vm,'Fixture.Choice',value)),expected);
  const a=vm.heap.allocate('box','Fixture.Choice',[3]),b=vm.heap.allocate('box','Fixture.Choice',[2]);
  assert.equal(enumHasFlag(vm,a,b),true);
  assert.equal(enumHasFlag(vm,a,vm.heap.allocate('box','Fixture.Choice',[4])),false);
});
test('enums CIL: unboxed arithmetic retains the declared enum when boxed again',()=>{
  const assembly=enumFixture({result:'string',body:(w,c)=>w.op('ldc.i4.1').op('box',c.enumToken).op('unbox.any',c.enumToken).op('ldc.i4.1').op('add').op('box',c.enumToken).op('callvirt',c.member('System.Enum','ToString','string',[],false)).op('ret')});
  const result=new CilVirtualMachine(assembly).run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.returnValue,'B');
});
test('strings CIL: independent literal tokens intern but concatenation allocates a distinct reference',()=>{
  const assembly=managedFixture({result:'bool',methods:[{name:'Main',result:'bool',body:(w,c)=>w.op('ldstr',0x70000000+c.md.userString('ab')).op('ldstr',0x70000000+c.md.userString('a')).op('ldstr',0x70000000+c.md.userString('b')).op('call',c.member('System.String','Concat','string',['string','string'])).op('call',c.member('System.Object','ReferenceEquals','bool',['object','object'])).op('ret')}]});
  const result=new CilVirtualMachine(assembly).run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.returnValue,false);
});

test('enums: zero-initialized static fields preserve enum identity across all engines',()=>{
  const compiled=compile('using Microsoft.UI.Xaml; class Program { static Visibility Value; static void Main() { Console.WriteLine(Value); } }');
  for(const make of Object.values(paths)) {
    const result=make(compiled).run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,'Visible\n');
  }
});
test('enums CIL: zero-initialized locals and arrays use the underlying zero value',()=>{
  const assembly=enumFixture({locals:['Fixture.Choice'],result:'int',body:(w,c)=>w.op('ldloc.0').op('ldc.i4.1').op('newarr',c.enumToken).op('ldc.i4.0').op('ldelem',c.enumToken).op('add').op('ret')});
  const result=new CilVirtualMachine(assembly).run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.returnValue,0);
});
test('enums CIL: boxed enum managed addresses cannot be confused with underlying int boxes',()=>{
  const assembly=enumFixture({result:'int',body:(w,c)=>w.op('ldc.i4.1').op('box',c.enumToken).op('unbox',c.enumToken).op('ldind.i4').op('ret')});
  const result=new CilVirtualMachine(assembly).run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.returnValue,1);
});

test('enums CIL: UInt32 enum unboxing retains signed evaluation-stack bits for conv.i8',()=>{
  const assembly=enumFixture({underlying:'uint',result:'long',body:(w,c)=>w.op('ldc.i4.m1').op('box',c.enumToken).op('unbox.any',c.enumToken).op('conv.i8').op('ret')});
  const result=new CilVirtualMachine(assembly).run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.returnValue,-1n);
});
