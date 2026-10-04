import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, loadAssembly, loadProjectAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, createProjectAssemblyInspector} from '@sharpforge/runtime';
import {DebugSession, CilDebugSession} from '@sharpforge/debugger';
import {counterApplicationSource, projectApplication, projectLibrary} from './support/project-assembly-fixtures.js';

const dependencies = (...projects) => projects.map(project => ({assembly: project.assembly}));

function executeBoth(application, libraries, check) {
  const options = {dependencies: dependencies(...libraries)};
  const graph = loadProjectAssembly(application.assembly, options);
  const inspector = createProjectAssemblyInspector(application.assembly, options);
  assert(inspector instanceof AssemblyInspector);
  for (const [name, machine] of [['source', new VirtualMachine(graph.image)], ['cil', new CilVirtualMachine(inspector)]]) {
    const result = machine.run();
    assert.equal(result.state, 'terminated', name + ': ' + JSON.stringify(result.fault));
    check(result, machine, name);
  }
  return {graph, inspector};
}

test('project runtime executes constructors, field initialization, properties, object returns and null faults on both engines', () => {
  const library = projectLibrary();
  const application = projectApplication(counterApplicationSource, [library]);
  const {inspector} = executeBoth(application, [library], result => assert.equal(result.output, '42\n42\n44\nnull\n'));
  assert.equal(inspector.modules.length, 2);
  assert.equal(inspector.metadata.counts[32], 2);
  const counters = inspector.types.filter(type => type.metadataName === 'Counter');
  assert.equal(counters.length, 1);
  const field = counters[0].fields.find(field => field.name === 'Total');
  assert.equal(inspector.resolveToken(field.token).assemblyKey, counters[0].assemblyKey);
  const references = inspector.modules[0].references;
  for (const reference of references.values()) {
    const token = inspector.metadata.mapToken(inspector.modules[0], reference.token);
    assert(inspector.resolveToken(token).resolvedToken, 'A verified external reference must resolve to its definition');
  }
});

test('transitive project calls share one state and explicit library entry invocation remains available', () => {
  const library = projectLibrary('Library', 'public class Value { public static int Total = 40; public static int Read() { return Total; } }');
  const middle = projectLibrary('Middle', 'public class Middle { public static int Add() { Value.Total += 2; return Value.Read(); } }',
    {references: [{bytes: library.assembly, runtimeProfile: 'sharpforge'}]});
  const application = projectApplication('System.Console.WriteLine(Middle.Add()); System.Console.WriteLine(Value.Read());', [middle, library]);
  executeBoth(application, [middle, library], result => assert.equal(result.output, '42\n42\n'));
  const inspector = createProjectAssemblyInspector(middle.assembly, {dependencies: dependencies(library)});
  const method = [...inspector.methods.values()].find(method => method.name === 'Add');
  const result = new CilVirtualMachine(inspector, {methodToken: method.token}).run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.returnValue, 42);
});

test('assembly-qualified objects, arrays, statics and reflection distinguish equal metadata names', () => {
  const source = 'public class Counter { public static int Total; public int Value; '
    + 'public Counter(int value) { Value = value; Total = value; } }';
  const left = projectLibrary('Left]part', source);
  const right = projectLibrary('Right[part', source);
  const application = projectApplication(`extern alias A; extern alias B;
    class Program { static void Main() {
      var a = new A::Counter(20); var b = new B::Counter(22);
      A::Counter[] values = new A::Counter[1]; values[0] = a;
      System.Console.WriteLine(values[0].Value + b.Value);
      System.Console.WriteLine(A::Counter.Total + B::Counter.Total);
      System.Console.WriteLine(a.GetType().FullName);
      System.Console.WriteLine(a.GetType() == b.GetType());
    } }`, [{...left, aliases: ['A']}, {...right, aliases: ['B']}]);
  executeBoth(application, [right, left], (result, machine) => {
    assert.equal(result.output, '42\n42\nCounter\nFalse\n');
    const types = [...machine.heap.methodTables.tables.values()].filter(type => type.metadataName === 'Counter');
    assert.equal(types.length, 2);
    assert.notEqual(types[0], types[1]);
    assert.notEqual(types[0].assemblyKey, types[1].assemblyKey);
  });
});

test('namespace-qualified dependency signatures and runtime reflection retain their metadata names', () => {
  const library = projectLibrary('Library', `namespace Example { public class Counter {
    public int Value; public Counter(int value) { Value = value; } public Counter Self() { return this; }
  } }`);
  const application = projectApplication('var counter = new Example.Counter(42); '
    + 'System.Console.WriteLine(counter.Self().Value); System.Console.WriteLine(counter.GetType().FullName);', [library]);
  executeBoth(application, [library], result => assert.equal(result.output, '42\nExample.Counter\n'));
});

test('public VM construction rejects unresolved external operations before any program effect', () => {
  const library = projectLibrary();
  const application = projectApplication('System.Console.WriteLine("must not run"); System.Console.WriteLine(Counter.Answer());', [library]);
  const output = [];
  for (const input of [application.image, loadAssembly(application.assembly), application.assembly]) {
    assert.throws(() => new VirtualMachine(input, {onOutput: value => output.push(value)}), {code: 'SF_RUNTIME_DEPENDENCIES'});
  }
  assert.throws(() => new CilVirtualMachine(application.assembly, {onOutput: value => output.push(value)}), /verification failed/);
  assert.throws(() => createProjectAssemblyInspector(application.assembly), {code: 'PRJ0002'});
  assert.deepEqual(output, []);
});

test('verified graph inspectors retain owned bytes and fresh VM static state across sessions', () => {
  const library = projectLibrary();
  const application = projectApplication('Counter.Total += 2; System.Console.WriteLine(Counter.Total);', [library]);
  const supplied = new Uint8Array(library.assembly);
  const inspector = createProjectAssemblyInspector(application.assembly, {dependencies: [{assembly: supplied}]});
  supplied.fill(0);
  assert.notEqual(inspector.modules[1].bytes[0], 0);
  for (let index = 0; index < 2; index++) {
    const result = new CilVirtualMachine(inspector).run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '42\n');
  }
});

test('same-path dependency source files remain independently debuggable on both engines', () => {
  const left = projectLibrary('Left', [{uri: 'Shared.cs', text: 'public class Left {\n public static int Read() {\n return 20;\n }\n}'}]);
  const right = projectLibrary('Right', [{uri: 'Shared.cs', text: 'public class Right {\n public static int Read() {\n return 22;\n }\n}'}]);
  const application = projectApplication('System.Console.WriteLine(Left.Read() + Right.Read());', [left, right]);
  const options = {dependencies: dependencies(left, right)};
  const graph = loadProjectAssembly(application.assembly, options);
  const inspector = createProjectAssemblyInspector(application.assembly, options);
  const sessions = [new DebugSession(graph.image), new CilDebugSession(inspector, {autoLoadSymbols: false})];
  for (const session of sessions) {
    const sources = session.vm.image?.sources ?? session.vm.inspector.debug.sources;
    const shared = sources.filter(source => source.originalUri === 'Shared.cs');
    assert.equal(shared.length, 2);
    assert.notEqual(shared[0].uri, shared[1].uri);
    assert.notEqual(shared[0].text, shared[1].text);
    const selected = shared.find(source => source.text.includes('return 22'));
    const [breakpoint] = session.setBreakpoints(selected.uri, [{line: 3}]);
    assert.equal(breakpoint.verified, true, breakpoint.message);
    session.start(false);
    const state = session.runUntilStop();
    assert.equal(state.state, 'paused');
    assert.equal(state.point.uri, selected.uri);
    assert.equal(state.point.line, 3);
    session.stop();
  }
});
