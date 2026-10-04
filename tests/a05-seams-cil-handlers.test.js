import test from 'node:test';
import assert from 'node:assert/strict';
import {CilOpcodes,isExecutableOpcode} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {cilHandlers} from '../packages/runtime/src/execution/handlers/index.js';
import {managedFixture} from './managed-fixtures.js';

// Compare the independent decoder/verifier inventory to the execution registry.
test('A05 CIL registry covers exactly the executable decoded opcodes',()=>{
  const expected=Object.keys(CilOpcodes).filter(isExecutableOpcode).sort();
  assert.deepEqual([...cilHandlers.keys()].sort(),expected);
  for(const handler of cilHandlers.values())assert.equal(typeof handler,'function');
});
test('A05 CIL registry executes compact/wide locals, indirect storage, branches and arrays',()=>{
  const bytes=managedFixture({methods:[{name:'Main',locals:['int','int[]'],result:'int',body:(w,c)=>w
    .op('ldc.i4.2').op('newarr',c.resolve('System.Int32')).op('stloc.1')
    .op('ldloc.1').op('ldc.i4.1').op('ldelema',c.resolve('System.Int32')).op('ldc.i4',42).op('stind.i4')
    .op('ldloc.1').op('ldc.i4.1').op('ldelem.i4').op('stloc',0)
    .op('ldloca',0).op('ldind.i4').op('ldc.i4',42).op('bne.un.s','bad')
    .op('ldloc',0).op('ret').mark('bad').op('ldc.i4.m1').op('ret')}]});
  const result=new CilVirtualMachine(bytes).run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.returnValue,42);
});
test('A05 CIL registry rejects unknown opcodes and out of bounds instruction pointers',()=>{
  const vm=new CilVirtualMachine(managedFixture());
  const original=vm.top.method.instructions;
  vm.top.method={...vm.top.method,instructions:[{name:'unknown.op',offset:0}]};
  assert.throws(()=>vm.step(),{name:'InvalidProgramException',message:"Unknown CIL opcode 'unknown.op'"});
  vm.top.method={...vm.top.method,instructions:original};vm.top.pc=original.length;
  assert.throws(()=>vm.step(),error=>error.name==='InvalidProgramException');
});
test('A05 CIL registry preserves first-chance stack and instruction position',()=>{
  const bytes=managedFixture({methods:[{name:'Main',result:'int',body:w=>w.op('ldc.i4.1').op('ldc.i4.0').op('div').op('ret')}]});
  const vm=new CilVirtualMachine(bytes);vm.onException=()=>true;
  vm.runSlice({instructionBudget:10,timeBudgetMs:1000});
  assert.equal(vm.state,'paused');assert.equal(vm.pendingFault.name,'DivideByZeroException');
  assert.equal(vm.top.method.instructions[vm.top.pc-1].name,'div');
  vm.onException=null;vm.state='running';assert.equal(vm.run().state,'faulted');
});
