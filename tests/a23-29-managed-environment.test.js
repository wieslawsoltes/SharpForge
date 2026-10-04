import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '@sharpforge/compiler';
import {emitAssembly} from '@sharpforge/cil';
import {ManagedInvocationSession, VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {contracts, findContracts} from '@sharpforge/framework';

function artifact(source, backend) {
  const compiled = compile(source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return backend === 'cil' ? emitAssembly(compiled.image) : compiled.image;
}

for (const backend of ['source', 'cil']) {
  test(`A23 T29 ${backend} reads explicit environment and isolated dictionary snapshots`, async () => {
    const source = `using System;
      class Entry { static void Main() {
        Console.WriteLine(Environment.GetEnvironmentVariable("NAME"));
        Console.WriteLine(Environment.GetEnvironmentVariable("missing") == null);
        Console.WriteLine(Environment.GetEnvironmentVariable("EMPTY").Length);
        Console.WriteLine(Environment.CurrentDirectory);
        var values = Environment.GetEnvironmentVariables();
        Console.WriteLine(values.Count);
        Console.WriteLine(values["NAME"]);
        Console.WriteLine(values.Contains("EMPTY"));
        values["NAME"] = "changed snapshot";
        values.Add("new", "value");
        Console.WriteLine(values.Count);
        Console.WriteLine(Environment.GetEnvironmentVariable("NAME"));
        Console.WriteLine(Environment.GetEnvironmentVariables().Count);
        var cursor = values.GetEnumerator();
        int count = 0;
        while (cursor.MoveNext()) { count++; }
        Console.WriteLine(count);
        values.Remove("new");
        values.Clear();
        Console.WriteLine(values.Count);
      } }`;
    const options = {environmentVariables: {NAME: 'session', EMPTY: ''}, workingDirectory: '/workspace/application'};
    const vm = backend === 'cil' ? new CilVirtualMachine(artifact(source, backend), options) :
      new VirtualMachine(artifact(source, backend), options);
    const result = await vm.runAsync();
    assert.equal(result.fault, null, result.fault?.message);
    assert.equal(result.output, 'session\nTrue\n0\n/workspace/application\n2\nsession\nTrue\n3\nsession\n2\n3\n0\n');
  });

  test(`A23 T29 ${backend} snapshots once per session and never inherits host environment`, async () => {
    const source = `using System; class Entry {
      static void Main() { }
      public static string Read() { return Environment.GetEnvironmentVariable("NAME"); }
      public static int Count() { return Environment.GetEnvironmentVariables().Count; }
      public static string Directory() { return Environment.CurrentDirectory; }
    }`;
    const environment = {NAME: 'first'};
    const first = new ManagedInvocationSession(artifact(source, backend), {backend, environment, currentDirectory: '/first'});
    const second = new ManagedInvocationSession(artifact(source, backend), {backend});
    try {
      assert.equal((await first.invoke('Entry.Read')).value, 'first');
      environment.NAME = 'mutated input';
      assert.equal((await first.invoke('Entry.Read')).value, 'first');
      assert.equal((await second.invoke('Entry.Count')).value, 0);
      assert.equal((await second.invoke('Entry.Read')).value, null);
      assert.equal((await second.invoke('Entry.Directory')).value, '/');
      assert.equal((await first.invoke('Entry.Directory')).value, '/first');
    } finally { first.dispose(); second.dispose(); }
  });

  test(`A23 T29 ${backend} rejects malformed canonical and alias environments before execution`, () => {
    const input = artifact('class Entry { static void Main() { } }', backend);
    const create = options => backend === 'cil' ? new CilVirtualMachine(input, options) : new VirtualMachine(input, options);
    const invalid = [{'bad=name': 'x'}, {NAME: 1}, null, [],
      Object.fromEntries(Array.from({length: 257}, (_, index) => ['N' + index, '']))];
    for (const value of invalid) {
      assert.throws(() => create({environmentVariables: value}), {name: 'RuntimeLaunchError', code: 'LAUNCH_ENVIRONMENT'});
      assert.throws(() => create({environment: value, environmentVariables: {NAME: 'fallback'}}),
        {name: 'RuntimeLaunchError', code: 'LAUNCH_ENVIRONMENT'});
    }
  });

  test(`A23 T29 ${backend} keeps null-name and working-directory failures as managed faults`, async () => {
    for (const [operation, options, expected] of [
      ['Environment.GetEnvironmentVariable(null)', {}, /ArgumentNullException/],
      ['Environment.CurrentDirectory', {workingDirectory: ''}, /ArgumentException/]
    ]) {
      const input = artifact(`using System; class Entry { static void Main() { var value = ${operation}; } }`, backend);
      const vm = backend === 'cil' ? new CilVirtualMachine(input, options) : new VirtualMachine(input, options);
      const result = await vm.runAsync();
      assert.match(result.fault?.type ?? result.fault?.name ?? '', expected);
    }
  });

  test(`A23 T29 ${backend} canonical launch settings take precedence over legacy aliases`, async () => {
    const input = artifact(`using System; class Entry { static void Main() {
      Console.WriteLine(Environment.GetEnvironmentVariable("NAME"));
      Console.WriteLine(Environment.GetEnvironmentVariables()["NAME"]);
      Console.WriteLine(Environment.CurrentDirectory);
    } }`, backend);
    const options = {environment: {NAME: 'canonical'}, environmentVariables: {NAME: 'alias'},
      workingDirectory: '/canonical', currentDirectory: '/alias'};
    const vm = backend === 'cil' ? new CilVirtualMachine(input, options) : new VirtualMachine(input, options);
    options.environment.NAME = 'host mutation';
    options.environmentVariables.NAME = 'alias mutation';
    const result = await vm.runAsync();
    assert.equal(result.fault, null, result.fault?.message);
    assert.equal(result.output, 'canonical\ncanonical\n/canonical\n');
  });
}

test('A23 T29 environment contracts use the A07 extension block without renumbering released contracts', () => {
  assert.equal(contracts.filter(contract => contract.id < 65536).length, 1744);
  for (const name of ['GetEnvironmentVariable', 'GetEnvironmentVariables', 'get_CurrentDirectory']) {
    const contract = findContracts('System.Environment', name, true)[0];
    assert.ok(contract.id >= 524288 && contract.id < 589824);
  }
  assert.equal(findContracts('System.Environment', 'GetEnvironmentVariables', true)[0].result, 'System.Collections.IDictionary');
});
