import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToAssembly} from '@sharpforge/compiler';
import {CilVirtualMachine} from '@sharpforge/runtime';

function assembly(source) {
  const result = compileToAssembly(source, {portablePdb: false});
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result.assembly;
}

const delegate = assembly(`using System;
delegate int Button();
class Program {
 static int Read() { return 23; }
 static int Main() { Button value = new Button(Read); return value() + value(); }
}`);

for (const inlineCaches of [false, true]) {
  test(`runtime delegate Invoke retains canonical dispatch without executable-body membership, caches ${inlineCaches}`, () => {
    const vm = new CilVirtualMachine(delegate, {inlineCaches});
    const invoke = vm.inspector.types.find(type => type.name === 'Button').methods.find(method => method.name === 'Invoke');
    try {
      assert.equal(invoke.hasBody, false);
      assert.equal(vm.report.methods.includes(invoke.token), false);
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.returnValue, 46);
      assert.equal(vm.report.methods.includes(invoke.token), false, 'A runtime contract is not fabricated as verified IL');
    } finally { vm.stop(); }
  });
}

test('abstract virtual declarations still resolve to verified concrete override bodies', () => {
  const bytes = assembly(`abstract class Base { public abstract int Value(); }
class Derived : Base { public override int Value() { return 42; } }
class Program { static int Main() { Base value = new Derived(); return value.Value(); } }`);
  const results = [];
  for (const inlineCaches of [false, true]) {
    const vm = new CilVirtualMachine(bytes, {inlineCaches});
    const declaration = vm.inspector.types.find(type => type.name === 'Base').methods.find(method => method.name === 'Value');
    const target = vm.inspector.types.find(type => type.name === 'Derived').methods.find(method => method.name === 'Value');
    try {
      assert.equal(declaration.hasBody, false);
      assert(vm.report.methods.includes(target.token));
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.returnValue, 42);
      results.push({value: result.returnValue, instructions: vm.instructions});
    } finally { vm.stop(); }
  }
  assert.deepEqual(results[1], results[0]);
});

test('runtime delegate null receiver still faults through the normal invocation contract', () => {
  const bytes = assembly(`using System;
delegate int Button();
class Program { static int Main() { Button value = null; return value(); } }`);
  for (const inlineCaches of [false, true]) {
    const vm = new CilVirtualMachine(bytes, {inlineCaches});
    try {
      const result = vm.run();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, 'NullReferenceException');
    } finally { vm.stop(); }
  }
});
