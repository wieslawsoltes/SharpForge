import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {projectReferenceLimits} from '@sharpforge/bytecode';
import {createRuntimeExecutable} from '../apps/studio/workers/runtime-launch.js';
import {runtimeAssemblyInput} from '../apps/studio/workers/runtime-inputs.js';
import {counterApplicationSource, projectApplication, projectLibrary} from './support/project-assembly-fixtures.js';
import {runtimeWorkerClient} from './support/runtime-worker-client.js';

const dependency = library => ({assembly: library.assembly, project: 'Library/Library.csproj', contextId: 'library-net10'});

test('worker cache keys cover the complete supplied graph, failures preserve the prior cache, and launch overlays are isolated', () => {
  const library = projectLibrary();
  const application = projectApplication(`class Program { static void Main(string[] args) {
    System.Console.WriteLine(Counter.Answer()); System.Console.WriteLine(args.Length);
  } }`, [library]);
  const request = {assembly: application.assembly, dependencies: [dependency(library)], args: ['one']};
  const executable = createRuntimeExecutable();
  const first = executable(request);
  assert.equal(first.load.cacheHit, false);
  assert.equal(first.load.modules, 2);
  assert.equal(new VirtualMachine(first.image).run().output, '42\n1\n');
  const second = executable({...request, args: ['one', 'two']});
  assert.equal(second.load.cacheHit, true);
  assert.equal(new VirtualMachine(second.image).run().output, '42\n2\n');
  assert.equal(new VirtualMachine(first.image).run().output, '42\n1\n');
  const changed = projectLibrary('Library', 'public class Counter { public static int Answer() { return 41; } }');
  assert.throws(() => executable({...request, dependencies: [dependency(changed)]}), {code: 'PRJ0003'});
  assert.equal(executable(request).load.cacheHit, true);
  const unused = projectLibrary('Unused', 'public class Unused { public static int Value() { return 1; } }');
  const unusedChanged = projectLibrary('Unused', 'public class Unused { public static int Value() { return 2; } }');
  assert.equal(executable({...request, dependencies: [dependency(library), {assembly: unused.assembly}]}).load.cacheHit, false);
  assert.equal(executable({...request, dependencies: [dependency(library), {assembly: unusedChanged.assembly}]}).load.cacheHit, false);
});

test('worker CIL cache retains immutable inspection data and creates independent runtime state', () => {
  const library = projectLibrary();
  const application = projectApplication('Counter.Total += 2; System.Console.WriteLine(Counter.Total);', [library]);
  const request = {assembly: application.assembly, dependencies: [dependency(library)], managedIL: true};
  const executable = createRuntimeExecutable();
  const first = executable(request);
  const second = executable(request);
  assert.equal(second.load.cacheHit, true);
  assert.equal(second.debugOptions.autoLoadSymbols, false);
  for (const loaded of [first, second]) assert.equal(new CilVirtualMachine(loaded.inspector).run().output, '42\n');
  assert.throws(() => executable({...request, pdb: new Uint8Array([1])}), /external symbol replacement/);
});

test('worker artifact normalization removes the entry PE and rejects malformed or oversized requests', () => {
  const library = projectLibrary();
  const input = runtimeAssemblyInput({assembly: library.assembly,
    dependencies: [{assembly: new Uint8Array(library.assembly)}]});
  assert.deepEqual(input.dependencies, []);
  assert.equal(input.totalBytes, library.assembly.length);
  assert.throws(() => runtimeAssemblyInput({assembly: library.assembly, dependencies: {}}), {code: 'PRJ0001'});
  assert.throws(() => runtimeAssemblyInput({assembly: library.assembly, dependencies: [{assembly: library.assembly, contextId: 'bad\0'}]}),
    {code: 'PRJ0001'});
  assert.throws(() => runtimeAssemblyInput({assembly: new Uint8Array(projectReferenceLimits.assemblyBytes + 1)}), {code: 'PRJ0006'});
  assert.throws(() => runtimeAssemblyInput({assembly: library.assembly,
    dependencies: Array(projectReferenceLimits.assemblies + 1).fill(dependency(library))}), {code: 'PRJ0006'});
});

for (const managedIL of [false, true]) {
  test(`production worker ${managedIL ? 'CIL' : 'source'} executes the complete supplied project graph`, async t => {
    const library = projectLibrary();
    const application = projectApplication(counterApplicationSource, [library]);
    const worker = runtimeWorkerClient(t);
    await worker.ready();
    const launched = await worker.request('launch', {assembly: application.assembly,
      dependencies: [dependency(library)], managedIL, debug: false});
    const state = await worker.wait(message => message.event === 'state' && message.sessionId === launched.sessionId
      && ['terminated', 'faulted'].includes(message.state));
    assert.equal(state.state, 'terminated', JSON.stringify(state.fault));
    assert.equal(state.output, '42\n42\n44\nnull\n');
    assert.equal(state.assemblyLoad.modules, 2);
  });

  test(`production worker ${managedIL ? 'CIL' : 'source'} preserves a paused graph when replacement validation fails`, async t => {
    const library = projectLibrary();
    const application = projectApplication('System.Console.WriteLine(Counter.Answer());', [library]);
    const worker = runtimeWorkerClient(t);
    await worker.ready();
    const request = {assembly: application.assembly, dependencies: [dependency(library)], managedIL, debug: true, stopOnEntry: true};
    const launched = await worker.request('launch', request);
    const stopped = await worker.wait(message => message.event === 'state' && message.sessionId === launched.sessionId && message.state === 'paused');
    await assert.rejects(worker.request('launch', {...request, dependencies: [{assembly: new Uint8Array([1, 2])}]}), {code: 'PRJ0001'});
    const state = await worker.request('state', {sessionId: launched.sessionId});
    assert.equal(state.state, 'paused');
    assert.deepEqual(state.point, stopped.point);
    await assert.rejects(worker.request('hotReload', {assembly: application.assembly}), {code: 'SF_RUNTIME_GRAPH_UPDATE'});
    await assert.rejects(worker.request('loadSymbols', {}), {code: 'SF_RUNTIME_GRAPH_UPDATE'});
    assert.equal((await worker.request('state')).state, 'paused');
  });
}

for (const managedIL of [false, true]) {
  test(`production worker ${managedIL ? 'CIL' : 'source'} composes project graphs with canonical and legacy launch settings`, async t => {
    const library = projectLibrary();
    const application = projectApplication(`class Program { static void Main(string[] args) {
      System.Console.WriteLine(Counter.Answer()); System.Console.WriteLine(args[0]);
      System.Console.WriteLine(System.Environment.GetEnvironmentVariable("VALUE"));
    } }`, [library]);
    const worker = runtimeWorkerClient(t);
    await worker.ready();
    for (const [settings, expected] of [
      [{args: ['legacy'], environmentVariables: {VALUE: 'alias'}}, 'legacy\nalias\n'],
      [{programArguments: ['canonical'], args: ['ignored'], environment: {VALUE: 'canonical'},
        environmentVariables: {VALUE: 'ignored'}}, 'canonical\ncanonical\n']
    ]) {
      const launched = await worker.request('launch', {assembly: application.assembly,
        dependencies: [dependency(library)], managedIL, debug: false, ...settings});
      assert.deepEqual(launched.capabilities, {arguments: true, environment: true, environmentMutation: false});
      const state = await worker.wait(message => message.event === 'state' && message.sessionId === launched.sessionId &&
        ['terminated', 'faulted'].includes(message.state));
      assert.equal(state.state, 'terminated', JSON.stringify(state.fault));
      assert.equal(state.output, '42\n' + expected);
      assert.equal(state.assemblyLoad.modules, 2);
    }
  });
}
