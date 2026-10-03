import test from 'node:test';
import assert from 'node:assert/strict';
import {contractForMember,types} from '@sharpforge/framework';
import {intrinsicDefinition,intrinsicDefinitions,intrinsicKey,supportedIntrinsic} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {intrinsicHandlers,invokeIntrinsic} from '../packages/runtime/src/execution/intrinsics.js';
import {managedFixture} from './managed-fixtures.js';
const descriptor=(owner,name,parameters,returnType,isStatic=true)=>({kind:'method',owner,name,signature:{parameters,returnType,isStatic,genericArity:0,callingConvention:0}});

test('A05 every accepted intrinsic signature has exactly one runtime handler and vice versa',()=>{
  const keys=new Set();
  for(const definition of intrinsicDefinitions) {
    assert(supportedIntrinsic(definition.descriptor),definition.key);
    assert.equal(intrinsicDefinition(definition.descriptor),definition);
    assert.equal(intrinsicKey(definition.descriptor),definition.key);
    assert.equal(typeof intrinsicHandlers.get(definition.key),'function',definition.key);
    assert(!keys.has(definition.key));keys.add(definition.key);
    const wrongReturn={...definition.descriptor,signature:{...definition.descriptor.signature,returnType:'Unsupported.ReturnType'}};
    assert.equal(supportedIntrinsic(wrongReturn),false,definition.key);
    assert.equal(intrinsicHandlers.has(intrinsicKey(wrongReturn)),false,definition.key);
  }
  assert.deepEqual([...intrinsicHandlers.keys()].sort(),[...keys].sort());
});
test('A05 framework declarations and inherited signatures retain exact contract selection',()=>{
  for(const definition of intrinsicDefinitions.filter(entry=>entry.contract))assert.equal(contractForMember(definition.descriptor),definition.contract,definition.key);
  // Existing framework contracts deliberately take precedence over primitive adapters.
  const sin=descriptor('System.Math','Sin',['double'],'double');
  assert.equal(intrinsicDefinition(sin).contract,contractForMember(sin));
  const inherited=intrinsicDefinitions.find(entry=>entry.contract&&entry.descriptor.owner!==entry.contract.owner&&types.has(entry.descriptor.owner));
  assert(inherited,'Expected an inherited framework contract');
  const calls=[],vm={platform:{invoke:(contract,args)=>{calls.push({contract,args});return 17;}}};
  const args=[];assert.equal(invokeIntrinsic(vm,inherited.descriptor,args),17);assert.deepEqual(calls,[{contract:inherited.contract,args}]);
});
test('A05 intrinsic signature boundaries reject wrong arity, staticness, generics and unknown owners',()=>{
  const valid=descriptor('System.Console','WriteLine',['int'],'void');assert(supportedIntrinsic(valid));
  for(const candidate of [
    {...valid,kind:'field'},
    {...valid,owner:'Unknown.Console'},
    {...valid,genericArguments:['int']},
    {...valid,signature:{...valid.signature,isStatic:false}},
    {...valid,signature:{...valid.signature,parameters:['int','int']}},
    {...valid,signature:{...valid.signature,genericArity:1}},
    {...valid,signature:{...valid.signature,callingConvention:5}}
  ]) {assert.equal(supportedIntrinsic(candidate),false);assert.throws(()=>invokeIntrinsic({},candidate,[]),error=>error.name==='MissingMethodException');}
});
test('A05 intrinsic adapters preserve overflow, null and string index faults',()=>{
  const vm=new CilVirtualMachine(managedFixture());
  assert.throws(()=>vm.intrinsic(descriptor('System.Math','Abs',['int'],'int'),[-2147483648]),error=>error.name==='OverflowException');
  assert.throws(()=>vm.intrinsic(descriptor('System.String','get_Length',[],'int',false),[null]),error=>error.name==='NullReferenceException');
  const text=vm.heap.string('x');
  assert.throws(()=>vm.intrinsic(descriptor('System.String','get_Chars',['int'],'char',false),[text,1]),error=>error.name==='IndexOutOfRangeException');
  assert.equal(vm.intrinsic(descriptor('System.String','get_Chars',['int'],'char',false),[text,0]),120);
});
test('A05 framework aliases do not broaden the legacy primitive intrinsic allowlist',()=>{
  assert.equal(supportedIntrinsic(descriptor('Math','Sqrt',['double'],'double')),false);
  assert.equal(supportedIntrinsic(descriptor('Math','Sin',['double'],'double')),true);
  assert.equal(supportedIntrinsic({...descriptor('string','get_Length',[],'int',false),genericArguments:['int']}),false);
  assert.equal(supportedIntrinsic(descriptor('System.Console','WriteLine',['String'],'void')),false);
  const length=descriptor('string','get_Length',[],'int',false),vm=new CilVirtualMachine(managedFixture());
  assert.equal(invokeIntrinsic(vm,length,[vm.heap.string('abc')]),3);
});
