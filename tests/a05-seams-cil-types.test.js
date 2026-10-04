import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {cilTypeSystemFixture as fixture} from './support/cil-type-system-fixture.js';

test('A05 CIL type membership is indexed before execution',()=>{
  const {vm,system,base,derived}=fixture(),ref=vm.heap.object(derived.name,[0,0]);
  vm.inspector.types.find=()=>{throw new Error('Linear type scan');};
  vm.inspector.metadata.typeName=()=>{throw new Error('Repeated ancestry metadata read');};
  assert.equal(system.typeOf(ref),derived.token);
  for(const type of [derived.name,base.name,'Example.Interface','object'])assert.equal(system.matches(ref,type),true);
  assert.equal(system.matches(ref,'Example.Unrelated'),false);assert.equal(system.matches(null,'object'),false);assert.equal(system.typeOf(null),null);
  const external=vm.heap.string('external');assert.equal(system.typeOf(external),null);assert.equal(system.matches(external,'string'),true);
});
test('A05 CIL layouts preserve inherited field offsets and reject foreign fields',()=>{
  const {vm,system,base,derived}=fixture(),layout=system.layout(derived.token),ref=vm.heap.object(derived.name,[12,34]);
  assert.deepEqual(layout.fields.map(field=>field.token),[base.fields[0].token,derived.fields[0].token]);
  assert.equal(system.layout(derived.token),layout);assert.equal(system.field(derived.fields[0].token,ref).index,1);
  assert.throws(()=>system.field(0x04000003,ref),error=>error.name==='InvalidProgramException');
  assert.throws(()=>system.layout(0x01000001),/External type allocation/);
});
test('A05 CIL metadata replacement rebuilds the derived indexes',()=>{
  const compile=value=>{const result=compileToIL(`var c=new C();Console.WriteLine(c.X);class C{public int X;public C(){X=${value};}}`);assert(result.success,JSON.stringify(result.diagnostics));return result.assembly;};
  const vm=new CilVirtualMachine(compile(1)),before=vm.typeSystem;
  vm.inspector=new AssemblyInspector(compile(2));
  assert.notEqual(vm.typeSystem,before);assert.equal(vm.layoutCache,vm.typeSystem.layouts);assert.equal(vm.typeSystem.inspector,vm.inspector);
});
test('A05 CIL call and static initialization adapters retain frame and depth contracts',()=>{
  const result=compileToIL('int F(int x){return x==0?42:F(x-1);}Console.WriteLine(F(3));');assert(result.success,JSON.stringify(result.diagnostics));
  const vm=new CilVirtualMachine(result.assembly);assert.equal(vm.run().output,'42\n');
  const limited=new CilVirtualMachine(result.assembly,{maxFrames:2}).run();assert.equal(limited.fault.name,'StackOverflowException');
});
