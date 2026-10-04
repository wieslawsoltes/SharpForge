import test from 'node:test';
import assert from 'node:assert/strict';
import {BuiltinMap,Builtins} from '@sharpforge/bytecode';
import {ManagedHeap,VirtualMachine} from '@sharpforge/runtime';
import {SUSPENDED} from '../packages/runtime/src/platform.js';
import {builtin} from '../packages/runtime/src/execution/source-builtins.js';
import {invokeNamedBuiltin,namedBuiltinHandlers} from '../packages/runtime/src/execution/source-builtins/index.js';
import {objectBuiltins} from '../packages/runtime/src/execution/source-builtins/objects.js';
import {collectionBuiltins} from '../packages/runtime/src/execution/source-builtins/collections.js';
import {serviceBuiltins} from '../packages/runtime/src/execution/source-builtins/services.js';

function services() {
  return {heap:new ManagedHeap(),strings:new Map(),snapshotOwner:Object.freeze({}),output:[],
    value:VirtualMachine.prototype.value,format:VirtualMachine.prototype.format,
    emitOutput(text){this.output.push(text);}};
}
const invoke=(vm,name,...args)=>builtin(vm,BuiltinMap.get(name).id,args);

function traceServices(value) {
  const trace=[];
  const vm={heap:{withRoots(args,action){trace.push(['roots',args]);try{return action();}finally{trace.push(['released']);}},
    collect(){trace.push(['collect']);}},
  value(input){trace.push(['value',input]);return value===undefined?input:value;}};
  return {vm,trace};
}

test('named builtin groups are frozen functions and prototype names retain managed missing-method faults',()=>{
  for(const group of [objectBuiltins,collectionBuiltins,serviceBuiltins,namedBuiltinHandlers]) {
    assert(Object.isFrozen(group));
    for(const handler of Object.values(group))assert.equal(typeof handler,'function');
    for(const handler of Object.values(group))assert(handler.name.length>0);
  }
  assert.equal(Object.getPrototypeOf(namedBuiltinHandlers),null);
  assert.throws(()=>{namedBuiltinHandlers['GC.Collect']=()=>0;},TypeError);
  for(const name of ['toString','constructor','__proto__','Missing.Intrinsic']) {
    assert.throws(()=>invokeNamedBuiltin({},name,[],undefined),{
      name:'MissingMethodException',message:`Intrinsic '${name}' is not implemented`
    });
  }
});

test('framework delegation precedes rooting/value evaluation and keeps lazy result metadata per VM',()=>{
  const entry=Builtins.find(entry=>entry?.contract&&entry.result==='void'),args=[1,2];
  assert(entry);
  const calls=[];
  const make=()=>({platform:{invoke(contract,actual){calls.push([contract,actual]);return SUSPENDED;}},
    get heap(){assert.fail('Contract dispatch must not enter rooted fallback');},
    value(){assert.fail('Contract dispatch must not evaluate fallback values');}});
  const first=make(),second=make();
  assert.equal(first.builtinResults,undefined);
  assert.equal(builtin(first,entry.id,args),SUSPENDED);
  const cache=first.builtinResults;
  assert.equal(builtin(first,entry.id,args),SUSPENDED);
  assert.equal(first.builtinResults,cache);
  assert.equal(builtin(second,entry.id,args),SUSPENDED);
  assert.notEqual(second.builtinResults,cache);
  for(const [contract,actual] of calls){assert.equal(contract,entry.contract);assert.equal(actual,args);}
});

test('legacy BCL runs inside roots without an extra fallback value conversion and hosts remain VM-local',()=>{
  const first=traceServices(),second=traceServices();
  assert.equal(first.vm.legacyBclHost,undefined);
  assert.equal(invoke(first.vm,'Convert.ToInt32',2.5),2);
  assert.deepEqual(first.trace,[['roots',[2.5]],['value',2.5],['released']]);
  const host=first.vm.legacyBclHost;
  assert.equal(invoke(first.vm,'Convert.ToInt32',3.5),4);
  assert.equal(first.vm.legacyBclHost,host);
  assert.equal(invoke(second.vm,'Convert.ToInt32',7.5),8);
  assert.notEqual(second.vm.legacyBclHost,host);
  assert.equal(first.vm.builtinResults,undefined);
  assert.equal(second.vm.builtinResults,undefined);
});

test('rooted prefixes and named handlers retain first-value timing even for no-argument calls',()=>{
  const collected=traceServices();
  assert.equal(invoke(collected.vm,'GC.Collect'),null);
  assert.deepEqual(collected.trace,[['roots',[]],['value',undefined],['collect'],['released']]);
  assert.equal(collected.vm.legacyBclHost,undefined);
  assert.equal(collected.vm.builtinResults,undefined);
  const math=traceServices(3.5);
  assert.equal(invoke(math.vm,'Math.Round',2.5),4);
  assert.equal(invoke(math.vm,'Math.Abs',-2),2);
  assert.deepEqual(math.trace,[['roots',[2.5]],['value',2.5],['released'],['roots',[-2]],['value',-2],['released']]);
  const integer=traceServices(-7);
  assert.equal(invoke(integer.vm,'$Math.Abs.Int32',-99),7);
  assert.deepEqual(integer.trace,[['roots',[-99]],['value',-99],['released']]);
});

test('object and string handlers preserve standalone services, type hints and managed identities',()=>{
  const vm=services(),text=vm.heap.string('A😀');
  assert.equal(invoke(vm,'string.Intern',text),text);
  assert.equal(invoke(vm,'string.IsInterned',vm.heap.string('A😀')),text);
  assert.equal(invoke(vm,'string.get_Chars',text,1),0xd83d);
  assert.equal(invoke(vm,'object.ReferenceEquals',text,text),true);
  assert.equal(invoke(vm,'object.ReferenceEquals',text,vm.heap.string('A😀')),false);
  const type=invoke(vm,'$type.double.GetType',1);
  assert.equal(vm.value(invoke(vm,'Type.Name',type)),'Double');
  assert.equal(vm.value(invoke(vm,'Type.FullName',type)),'System.Double');
  const flag={enumType:'Fixture.Flags',value:1},both={enumType:'Fixture.Flags',value:3};
  assert.equal(invoke(vm,'Enum.HasFlag',both,flag),true);
  assert.equal(vm.heap.pins.length,0);
});

test('collection and allocation handlers preserve argument roots and mutation behavior without an image',()=>{
  const vm=services(),array=vm.heap.array('int',3);
  vm.heap.get(array).data=[3,1,2];
  const value=vm.value;
  vm.value=function(input){if(input===array)this.heap.collect();return value.call(this,input);};
  assert.equal(invoke(vm,'Array.Sort',array),null);
  assert.deepEqual(vm.heap.get(array).data,[1,2,3]);
  assert.equal(invoke(vm,'Array.Reverse',array),null);
  assert.deepEqual(vm.heap.get(array).data,[3,2,1]);
  const message=vm.heap.string('failure');
  vm.heap.threshold=vm.heap.stats.liveBytes;
  const exception=invoke(vm,'Exception.new',message);
  assert.equal(invoke(vm,'Exception.Message',exception),message);
  assert.equal(vm.value(message),'failure');
  assert.equal(typeof invoke(vm,'GC.GetTotalMemory',false),'bigint');
  assert(invoke(vm,'GC.CollectionCount',0)>0);
  assert.equal(vm.heap.pins.length,0);
});

test('output and managed faults retain their values, messages and root cleanup',()=>{
  const vm=services(),message=vm.heap.string('stop');
  assert.equal(invoke(vm,'Console.WriteLine'),null);
  assert.equal(invoke(vm,'Console.Write',true),null);
  assert.deepEqual(vm.output,['\n','True']);
  assert.equal(invoke(vm,'Debug.Assert',true),null);
  for(const [name,args,type,text] of [
    ['$Math.Abs.Int32',[-2147483648],'OverflowException','Absolute value of Int32.MinValue is not representable'],
    ['GC.CollectionCount',[3],'ArgumentOutOfRangeException','GC generation must be between 0 and 2'],
    ['Debug.Assert',[false,message],'AssertionException','stop']
  ]) {
    assert.throws(()=>invoke(vm,name,...args),{name:type,message:text});
    assert.equal(vm.heap.pins.length,0);
  }
  assert.equal(Number.isInteger(invoke(vm,'Environment.TickCount')),true);
});
