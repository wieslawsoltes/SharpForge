import test from 'node:test';
import assert from 'node:assert/strict';
import {loadProjectAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, createProjectAssemblyInspector} from '@sharpforge/runtime';
import {projectApplication, projectLibrary} from './support/project-assembly-fixtures.js';

function run(source, application, expected) {
  const library = projectLibrary('Initializers', source);
  assert(library.image.methods.some(method => method.name === '.cctor'), 'This fixture exercises actual library .cctor bodies');
  const entry = projectApplication(application, [library]);
  const options = {dependencies: [{assembly: library.assembly}]};
  const graph = loadProjectAssembly(entry.assembly, options);
  for (const machine of [new VirtualMachine(graph.image), new CilVirtualMachine(createProjectAssemblyInspector(entry.assembly, options))]) {
    const result = machine.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, expected);
  }
}

test('actual library type initializers run lazily before external and local calls and once per source session', () => {
  run(`public class First {
    public static int Value = Initialize();
    public static int Initialize() { System.Console.WriteLine("first init"); return 20; }
    public static int Call() { System.Console.WriteLine("first call"); return Second.Call(); }
  }
  public class Second {
    public static int Value = Initialize();
    public static int Initialize() { System.Console.WriteLine("second init"); return 22; }
    public static int Call() { System.Console.WriteLine("second call"); return 42; }
  }
  public class Unused {
    public static int Value = Initialize();
    public static int Initialize() { System.Console.WriteLine("unused init"); return 0; }
  }`, 'System.Console.WriteLine("before"); System.Console.WriteLine(First.Call()); '
    + 'System.Console.WriteLine(First.Value + Second.Value); System.Console.WriteLine(First.Value + Second.Value);',
  'before\nfirst init\nfirst call\nsecond init\nsecond call\n42\n42\n42\n');
});

test('namespaced library initializers preserve reentrant default values and constructor initialization order', () => {
  run(`namespace Example { public class First { public static int Value = Second.Value + 1; }
    public class Second { public static int Value = First.Value + 1; }
    public class Instance {
      public static int Value = Initialize();
      public int Field = Read();
      public static int Initialize() { System.Console.WriteLine("static"); return 42; }
      public static int Read() { System.Console.WriteLine("instance"); return Value; }
      public Instance() { System.Console.WriteLine("constructor"); }
    } }`, 'System.Console.WriteLine(Example.First.Value); System.Console.WriteLine(Example.Second.Value); '
      + 'var value = new Example.Instance(); System.Console.WriteLine(value.Field);',
  '2\n1\nstatic\ninstance\nconstructor\n42\n');
});

test('failed real library initialization is cached and never repeats initializer effects', () => {
  run(`public class Failure {
    public static int Value = Initialize();
    public static int Initialize() { System.Console.WriteLine("initialize"); throw new System.Exception("failure"); }
  }`, 'try { System.Console.WriteLine(Failure.Value); } catch (System.Exception) { System.Console.WriteLine("caught"); } '
    + 'try { System.Console.WriteLine(Failure.Value); } catch (System.Exception) { System.Console.WriteLine("caught"); }',
  'initialize\ncaught\ncaught\n');
});
