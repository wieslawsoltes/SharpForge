import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine,ManagedFault} from '@sharpforge/runtime';
import {continueUnwind,throwFault} from '../packages/runtime/src/execution/eh.js';
import {managedFixture} from './managed-fixtures.js';

function compile(source){const result=compileToIL(source,{includeDebug:false});assert(result.success,JSON.stringify(result.diagnostics));return result.assembly;}
test('A05 CIL EH preserves nested leave continuations across snapshot and collection',()=>{
  const vm=new CilVirtualMachine(compile('int F(){try{return 42;}finally{try{throw new Exception("inside");}catch(Exception e){GC.Collect();Console.WriteLine(e.Message);}}}Console.WriteLine(F());'));
  const snapshots=[];
  while(vm.state==='ready'||vm.state==='running') {
    if(vm.top?.pending)snapshots.push(vm.snapshot());
    vm.runSlice({instructionBudget:1,timeBudgetMs:1000});
  }
  assert.equal(vm.state,'terminated',vm.fault?.stack);assert.equal(vm.output.join(''),'inside\n42\n');assert(snapshots.length>0);
  for(const snapshot of snapshots) {
    vm.restore(snapshot);vm.heap.collect();const result=vm.run();
    assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,'inside\n42\n');
  }
});
test('A05 CIL EH catch rethrow retains original exception and bypasses completed catch',()=>{
  const vm=new CilVirtualMachine(compile('try{try{throw new Exception("original");}catch(Exception e){Console.WriteLine(e.Message);throw;}}catch(Exception e){Console.WriteLine(e.Message);}'));
  const faults=[];vm.onException=fault=>{faults.push(fault);return false;};
  const result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,'original\noriginal\n');
  assert.equal(faults.length,2);assert.equal(faults[0],faults[1]);
});
test('A05 CIL EH rejects endfinally and rethrow outside active regions',()=>{
  const vm=new CilVirtualMachine(managedFixture());
  assert.throws(()=>continueUnwind(vm,vm.top),error=>error.name==='InvalidProgramException');
  assert.throws(()=>throwFault(vm,null,{name:'rethrow',offset:0}),error=>error.name==='InvalidProgramException');
});
test('A05 CIL EH fatal resource faults bypass user catches and preserve debugger frame state',()=>{
  const vm=new CilVirtualMachine(compile('try{Console.WriteLine("long");}catch(Exception e){Console.WriteLine("caught");}'),{maxOutputCharacters:1});
  const result=vm.run();assert.equal(result.state,'faulted');assert.equal(result.fault.name,'OutputLimitException');assert.equal(result.output,'');
  assert(vm.top);assert.deepEqual(vm.top.unwinds,[]);assert.equal(vm.top.pending,null);
});
test('A05 CIL EH root enumeration includes paused catch and finally fault references',()=>{
  const vm=new CilVirtualMachine(managedFixture()),ref=vm.heap.allocate('exception','System.Exception',[null]);
  const fault=new ManagedFault('System.Exception','root',ref),frame=vm.top;
  frame.caught.push({start:0,end:1,fault});frame.unwinds.push({error:fault});
  assert.equal([...vm.exceptionRoots(frame)].length,2);
  vm.heap.collect();assert.equal(vm.heap.get(ref).kind,'exception');
});
