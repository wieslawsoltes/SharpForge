import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';

const echo=type=>controlFixture([{name:'Program',methods:[{name:'Main',result:type,parameters:[type],body:w=>w.op('ldarg.0').op('ret')}]}]);

for(const nativeIntBits of [32,64])test(`A05 T01 host native ABI${nativeIntBits} input, result and layout agree`,()=>{
  const unsigned=(1n<<BigInt(nativeIntBits))-1n;
  const vm=new CilVirtualMachine(echo('nuint'),{nativeIntBits,arguments:[unsigned.toString()]});
  const result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);
  assert.equal(result.returnValue,nativeIntBits===32?Number(unsigned):unsigned);
  assert.equal(vm.resultDisplay(),unsigned.toString());
  assert.equal(vm.heap.methodTables.get('nuint').valueSize,nativeIntBits/8);
  const sizes=controlFixture([{name:'Program',methods:[{name:'Main',result:'int',body:(w,c)=>w.op('sizeof',c.resolve('System.IntPtr')).op('sizeof',c.resolve('System.Decimal')).op('add').op('ret')}]}]);
  assert.equal(new CilVirtualMachine(sizes,{nativeIntBits}).run().returnValue,nativeIntBits/8+16);
  assert.throws(()=>new CilVirtualMachine(echo('nuint'),{nativeIntBits,arguments:[(unsigned+1n).toString()]}),/out of range/);
  assert.throws(()=>new CilVirtualMachine(echo('nint'),{nativeIntBits,arguments:[Number.MAX_SAFE_INTEGER+1]}),/exact integer/);
});

test('A05 T01 Decimal host values preserve scale and reject approximate input',()=>{
  const bytes=echo('System.Decimal');
  for(const value of ['1.2300',[12300,0,0,4<<16],{scalar:'decimal',value:[12300,0,0,4<<16]}]) {
    const vm=new CilVirtualMachine(bytes,{arguments:[value]}),result=vm.run();
    assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(vm.resultDisplay(),'1.2300');
  }
  assert.throws(()=>new CilVirtualMachine(bytes,{arguments:[1.23]}),/exact text/);
  assert.throws(()=>new CilVirtualMachine(bytes,{arguments:[[1,0,0,29<<16]]}),{name:'ArgumentException'});
});
