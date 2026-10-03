import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {typedNumericSlots, NumericSlotTag} from '../packages/runtime/src/execution/typed-stack.js';

test('T09 verified maxstack replaces the global evaluation-stack push limit', () => {
  const result = compileToIL('double x=1.5;double y=2.25;Console.WriteLine(x+y);');
  assert(result.success, JSON.stringify(result.diagnostics));
  for (const typedNumericStack of [false, true]) {
    const vm = new CilVirtualMachine(result.assembly, {maxStackValues: 0, typedNumericStack});
    const execution = vm.run();
    assert.equal(execution.state, 'terminated', execution.fault?.message);
    assert.equal(execution.output, '3.75\n');
  }
});

test('T09 malformed method maxstack is rejected before execution, including incoming catch stack', () => {
  const result = compileToIL('try {throw new Exception("failure");} catch(Exception e) {Console.WriteLine(e.Message);}');
  assert(result.success, JSON.stringify(result.diagnostics));
  for (const maximum of [-1, NaN, 1.5, 65536]) {
    const inspector = new AssemblyInspector(result.assembly), report = verifyCilAssembly(inspector);
    const entry = inspector.getMethod(report.entryPoint);
    entry.maxStack = maximum;
    assert(verifyCilAssembly(inspector).issues.some(issue => issue.code === 'IL_STACK'));
  }
  // A catch starts with one exception even when its first instruction pops it.
  const inspector = new AssemblyInspector(result.assembly), report = verifyCilAssembly(inspector);
  const method = report.methods.map(token => inspector.getMethod(token)).find(candidate => candidate.handlers.length);
  method.maxStack = 0;
  assert(verifyCilAssembly(inspector).issues.some(issue => /Incoming evaluation stack/.test(issue.message)));
});

test('T09 standalone unverified numeric storage retains its explicit bound', () => {
  const slots = typedNumericSlots([], 1, 1);
  slots.pushFloat(1.5, NumericSlotTag.r8);
  assert.throws(() => slots.pushFloat(2.5, NumericSlotTag.r8), {name: 'ExecutionLimitException'});
});
