import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

function arrayStore(value) {
  return managedFixture({methods:[{name:'Main',result:'void',body:(w,c)=>{
    w.op('ldc.i4.1').op('newarr',c.resolve('System.String')).op('ldc.i4.0');value(w,c);w.op('stelem.ref').op('ret');
  }}]});
}
test('A05 T23 covariant array stores accept null and compatible references',()=>{
  for(const value of [w=>w.op('ldnull'),(w,c)=>w.op('ldstr',0x70000000+c.md.userString('valid'))]) {
    const result=new CilVirtualMachine(arrayStore(value)).run();assert.equal(result.state,'terminated',result.fault?.stack);
  }
});
test('A05 T23 covariant array stores reject boxed values using the actual element header',()=>{
  const result=new CilVirtualMachine(arrayStore((w,c)=>w.op('ldc.i4.1').op('box',c.resolve('System.Int32')))).run();
  assert.equal(result.state,'faulted');assert.equal(result.fault.name,'ArrayTypeMismatchException');
});
test('A05 T23 castclass and isinst use array covariance without losing identity',()=>{
  for(const instruction of ['castclass','isinst']) {
    const assembly=managedFixture({methods:[{name:'Main',result:'bool',body:(w,c)=>w.op('ldc.i4.1').op('newarr',c.resolve('System.String')).op('dup').op(instruction,c.md.add(27,[c.md.blob(new Uint8Array([0x1d,0x1c]))])).op('ceq').op('ret')}]});
    const result=new CilVirtualMachine(assembly).run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.returnValue,true);
  }
});
test('A05 T23 writable array element addresses reject covariant element types',()=>{
  const assembly=managedFixture({methods:[{name:'Main',result:'void',body:(w,c)=>w.op('ldc.i4.1').op('newarr',c.resolve('System.String')).op('ldc.i4.0').op('ldelema',c.resolve('System.Object')).op('pop').op('ret')}]});
  const result=new CilVirtualMachine(assembly).run();assert.equal(result.state,'faulted');assert.equal(result.fault.name,'ArrayTypeMismatchException');
});
test('A05 T23 unbox.any on reference types performs the corresponding class cast',()=>{
  const assembly=managedFixture({methods:[{name:'Main',result:'string',body:(w,c)=>w.op('ldstr',0x70000000+c.md.userString('cast')).op('unbox.any',c.resolve('System.String')).op('ret')}]});
  const result=new CilVirtualMachine(assembly).run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.returnValue,'cast');
});
