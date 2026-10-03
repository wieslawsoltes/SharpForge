import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine,CilVirtualMachine} from '@sharpforge/runtime';
import {sourceScalarCases} from './a05-01-fixtures.js';
import {readFileSync} from 'node:fs';

for(const engine of ['source','reloaded','cil'])for(const fixture of sourceScalarCases)test(`A05 T01 ${engine}: ${fixture.name}`,()=>{
  const compiled=compileToIL(fixture.source);
  assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const vm=engine!=='cil'?new VirtualMachine(engine==='reloaded'?loadAssembly(compiled.assembly):compiled.image):new CilVirtualMachine(compiled.assembly),result=vm.run();
  assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,fixture.output);
});

for(const engine of ['source','reloaded','cil'])for(const nativeIntBits of [32,64])test(`A05 T01 ${engine}: native ABI${nativeIntBits} survives snapshots`,()=>{
  const source='nint value=(nint)1;Console.WriteLine((long)(value<<40));';
  const compiled=compileToIL(source);assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const vm=engine!=='cil'?new VirtualMachine(engine==='reloaded'?loadAssembly(compiled.assembly):compiled.image,{nativeIntBits}):new CilVirtualMachine(compiled.assembly,{nativeIntBits});
  const saved=vm.snapshot(),first=vm.run();vm.restore(saved);const second=vm.run();
  assert.equal(first.state,'terminated',first.fault?.stack);assert.equal(second.output,first.output);
  assert.equal(first.output,nativeIntBits===64?'1099511627776\n':'256\n');
});

for(const engine of ['source','reloaded','cil'])test(`A05 T01 ${engine}: bounded execution interrupts Decimal loops`,()=>{
  const source='decimal value=0M;while(true){value=value+0.1M;}';
  const compiled=compileToIL(source);assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const vm=engine!=='cil'?new VirtualMachine(engine==='reloaded'?loadAssembly(compiled.assembly):compiled.image,{maxInstructions:1000}):new CilVirtualMachine(compiled.assembly,{maxInstructions:1000});
  assert.equal(vm.run().fault.name,'InstructionLimitException');
});

for(const engine of ['source','reloaded','cil'])test(`A05 T01 ${engine}: runnable scalar example`,()=>{
  const source=readFileSync(new URL('../examples/features-a05/scalar-numerics.cs',import.meta.url),'utf8');
  const compiled=compileToIL(source);assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const vm=engine!=='cil'?new VirtualMachine(engine==='reloaded'?loadAssembly(compiled.assembly):compiled.image):new CilVirtualMachine(compiled.assembly),result=vm.run();
  assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,'4294967295\n0\n1\n23.9400\nOverflowException\n');
});

for(const engine of ['source','reloaded','cil'])for(const nativeIntBits of [32,64])test(`A05 T01 ${engine}: native conversion remains architecture-dependent for ABI${nativeIntBits}`,()=>{
  const compiled=compileToIL('long wide=4294967296L;nint value=unchecked((nint)wide);Console.WriteLine((long)value);Console.WriteLine((long)unchecked((nint)4294967296L));');assert(compiled.success,JSON.stringify(compiled.diagnostics));
  const vm=engine==='cil'?new CilVirtualMachine(compiled.assembly,{nativeIntBits}):new VirtualMachine(engine==='reloaded'?loadAssembly(compiled.assembly):compiled.image,{nativeIntBits});
  const result=vm.run();assert.equal(result.state,'terminated',result.fault?.stack);assert.equal(result.output,nativeIntBits===64?'4294967296\n4294967296\n':'0\n0\n');
});
