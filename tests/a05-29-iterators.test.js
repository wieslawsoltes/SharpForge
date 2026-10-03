import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';

// The independent IL fixture isolates interface dispatch and persisted iterator
// state. tests/fixtures/a05-iterators is the actual Roslyn/native qualification.
function iteratorFixture() {
  const enumerator='System.Collections.IEnumerator',disposable='System.IDisposable';
  return controlFixture([
    {name:'Program',methods:[{name:'Main',locals:['Iterator'],body:(w,c)=>{
      const move=c.member(enumerator,'MoveNext','bool',[],false),current=c.member(enumerator,'get_Current','object',[],false),dispose=c.member(disposable,'Dispose','void',[],false);
      w.op('newobj',c.methods.get('Iterator..ctor')).op('stloc.0');
      for(let index=0;index<2;index++)w.op('ldloc.0').op('callvirt',move).op('pop').op('ldloc.0').op('callvirt',current).op('unbox.any',c.resolve('System.Int32')).op('call',c.member('System.Console','WriteLine','void',['int']));
      w.op('ldloc.0').op('callvirt',move).op('call',c.member('System.Console','WriteLine','void',['bool']));
      w.op('ldloc.0').op('callvirt',dispose).op('ldloc.0').op('callvirt',move).op('call',c.member('System.Console','WriteLine','void',['bool'])).op('ret');
    }}]},
    {name:'Iterator',interfaces:[enumerator,disposable],fields:[{name:'State',flags:6},{name:'Current',flags:6}],methods:[
      {name:'.ctor',static:false,flags:0x1886,body:(w,c)=>w.op('ldarg.0').op('call',c.member('System.Object','.ctor','void',[],false)).op('ret')},
      {name:'MoveNext',static:false,flags:0x1e6,result:'bool',body:(w,c)=>{
        const state=c.fields.get('Iterator.State'),current=c.fields.get('Iterator.Current');
        w.op('ldarg.0').op('ldfld',state).op('switch',['first','second']).op('ldc.i4.0').op('ret');
        for(const [label,value,next] of [['first',20,1],['second',22,2]])w.label(label).op('ldarg.0').op('ldc.i4',value).op('stfld',current).op('ldarg.0').op('ldc.i4',next).op('stfld',state).op('ldc.i4.1').op('ret');
      }},
      {name:'get_Current',static:false,flags:0x1e6,result:'object',body:(w,c)=>w.op('ldarg.0').op('ldfld',c.fields.get('Iterator.Current')).op('box',c.resolve('System.Int32')).op('ret')},
      {name:'Reset',static:false,flags:0x1e6,body:(w,c)=>w.op('newobj',c.member('System.NotSupportedException','.ctor','void',[],false)).op('throw')},
      {name:'Dispose',static:false,flags:0x1e6,body:(w,c)=>w.op('ldarg.0').op('ldc.i4.2').op('stfld',c.fields.get('Iterator.State')).op('ldstr',0x70000000+c.md.userString('disposed')).op('call',c.member('System.Console','WriteLine','void',['string'])).op('ret')}
    ]}
  ]);
}
test('A05 T29 IEnumerator advances, completes and disposes through interface slots',()=>{
  const result=new CilVirtualMachine(iteratorFixture()).run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,'20\n22\nFalse\ndisposed\nFalse\n');
});
test('A05 T29 iterator state survives pause, snapshot and collection between yields',()=>{
  const vm=new CilVirtualMachine(iteratorFixture());for(let i=0;i<1000&&!vm.output.length;i++)vm.step();
  assert.equal(vm.output.join(''),'20\n');const snapshot=vm.snapshot(),result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);
  vm.restore(snapshot);vm.heap.collect();const replay=vm.run();assert.equal(replay.state,'terminated',replay.fault?.stack);assert.equal(replay.output,result.output);
});
