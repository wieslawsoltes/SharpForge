import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { managedFixture } from './managed-fixtures.js';
import { compileProgram, programVM, runProgram } from './a19-runtime-programs.js';

const source = `using System;
class Program {
  static void Main(string[] args) {
    Console.WriteLine(Environment.GetEnvironmentVariable("VALUE") ?? "missing");
    Console.WriteLine(Environment.GetEnvironmentVariable("EMPTY") == "");
    Console.WriteLine(Environment.GetEnvironmentVariable("value") == null);
    Console.WriteLine(Environment.GetEnvironmentVariable("ABSENT") == null);
    Console.WriteLine(Environment.GetEnvironmentVariable("") == null);
  }
}`;

for (const engine of ['source', 'cil']) {
  test(engine + ' reads only its explicit environment, preserving empty values and case-sensitive names', async () => {
    const compiled = compileProgram(source);
    const result = await runProgram(compiled, engine, { environment: { VALUE: 'value 雪', EMPTY: '' } });
    assert.equal(result.output, 'value 雪\nTrue\nTrue\nTrue\nTrue\n');
  });

  test(engine + ' separate runtimes copy environment values and never observe another application', async () => {
    const compiled = compileProgram('Console.WriteLine(System.Environment.GetEnvironmentVariable("VALUE") ?? "missing");');
    const environment = { VALUE: 'first' };
    const first = programVM(compiled, engine, { environment, virtualTime: true });
    environment.VALUE = 'mutated';
    const second = programVM(compiled, engine, { environment: { VALUE: 'second' }, virtualTime: true });
    assert.equal((await second.runAsync()).output, 'second\n');
    second.stop();
    assert.equal((await first.runAsync()).output, 'first\n');
    first.stop();
    assert.equal((await runProgram(compiled, engine)).output, 'missing\n');
  });

  test(engine + ' a null environment variable name raises a managed ArgumentNullException', () => {
    const compiled = compileProgram('Console.WriteLine(System.Environment.GetEnvironmentVariable(null));');
    const vm = programVM(compiled, engine);
    const result = vm.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'ArgumentNullException');
    vm.stop();
  });
}

test('environment mutation and OS target overloads report unsupported source members', () => {
  for (const source of [
    'System.Environment.SetEnvironmentVariable("VALUE", "changed");',
    'System.Environment.GetEnvironmentVariable("VALUE", 0);'
  ]) {
    const result = compile(source);
    assert.equal(result.success, false);
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.severity === 'error'), true);
  }
});

test('independent managed CIL resolves the registered process environment signature and refuses mutation', () => {
  const fixture = name => managedFixture({ methods: [{
    name: 'Main', parameters: ['string'], result: 'string',
    body(writer, context) {
      writer.op('ldarg.0').op('call', context.member('System.Environment', name, 'string', ['string'])).op('ret');
    }
  }] });
  const vm = new CilVirtualMachine(fixture('GetEnvironmentVariable'), { arguments: ['VALUE'], environment: { VALUE: 'direct' } });
  assert.equal(vm.run().returnValue, 'direct');
  vm.stop();
  assert.throws(() => new CilVirtualMachine(fixture('SetEnvironmentVariable'), { arguments: ['VALUE'] }), /External member.*not implemented/);
});
