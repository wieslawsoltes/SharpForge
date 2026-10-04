import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, decodeCoded } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { runToEnd } from '../packages/compiler/test/differential/run-program.js';

// SF-A02-T30: miscompiles the stress family of the differential corpus exposed - assemblies that were emitted and
// printed something else than the Roslyn build, or did not load. The reduced programs are the corpus fixtures
// `reduced-calls/*`, `reduced-interfaces/*` and `reduced-tuples/*` (pinned from Roslyn 5.3.0, run on .NET 10.0.5 by
// tests/compiler-stress-corpus.test.js); the programs here are the same defects in a form that is checked where no
// .NET SDK is installed: run on the direct-CIL VM, or - where its profile has no tuples or Nullable<T> - read as IL.

/** Compiles with the direct CIL pipeline; any error fails the test. */
function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  return result;
}

/** What the program prints on the direct-CIL VM. */
function run(source) {
  const outcome = runToEnd(new CilVirtualMachine(emit(source).assembly, { maxInstructions: 1_000_000, virtualTime: true }));
  assert.equal(outcome.state, 'terminated', String(outcome.fault?.message ?? outcome.state));
  return outcome.output;
}

/** The instruction names of one method. */
function instructionNames(source, owner, name) {
  const inspector = new AssemblyInspector(emit(source).assembly),
    type = inspector.types.find(candidate => candidate.name === owner) ?? assert.fail(`no type ${owner}`),
    method = type.methods.find(candidate => candidate.name === name) ?? assert.fail(`no method ${owner}::${name}`);
  return inspector.getMethod(method.token).instructions.map(instruction => instruction.name);
}

const count = (names, wanted) => names.filter(name => name === wanted).length;

test('A02-T30 an omitted argument takes the default of the most derived override on the receiver', () => {
  const output = run(`using System;
    class A { public virtual int F(int x = 1, int y = 10) { return x + y; } public virtual int this[int i, int k = 2] { get { return i * k; } } }
    class B : A { public override int F(int a = 2, int b = 20) { return base.F(a, b) + 100; } public override int this[int i, int k = 3] { get { return base[i, k]; } } }
    class C : B { public override int F(int p = 3, int q = 30) { return base.F(p, q) + 1000; } public int Self() { return F() + this.F(q: 1); } }
    class P { static void Main() {
      A a = new C(); B b = new C(); C c = new C();
      Console.WriteLine(a.F() + " " + b.F() + " " + c.F() + " " + a.F(y: 5) + " " + b.F(b: 5) + " " + c.F(q: 5, p: 4));
      Console.WriteLine(a[4] + " " + b[4] + " " + c.Self());
    } }`);
  assert.equal(output, '1111 1122 1133 1106 1107 1109\n8 12 2237\n');
});

test('A02-T30 a null argument for a parameter of a nullable value type is a value, not a null reference', () => {
  const names = instructionNames(
    `using System;
    class Box<T> { public T Value; public Box(T value) { Value = value; } public T this[T other] { get { return other; } } }
    class P {
      static string Plain(int? value) { return value.HasValue ? "value" : "none"; }
      static T Pick<T>(bool first, T a, T b) { return first ? a : b; }
      static void Main() {
        Console.WriteLine(Plain(null) + Pick<int?>(true, null, 5).HasValue + new Box<long?>(null).Value.HasValue + new Box<int?>(1)[null].HasValue);
      }
    }`,
    'P',
    'Main',
  );
  // `ldnull` pushes an object reference; a Nullable<T> argument is `initobj` of a temporary (InvalidProgramException otherwise).
  assert.equal(count(names, 'ldnull'), 0);
  assert.equal(count(names, 'initobj'), 4);
});

test('A02-T30 a lambda in a tuple literal is bound as the delegate type of the target element', () => {
  const names = instructionNames(
    `using System;
    class P {
      static int Apply((int Seed, Func<int, int> Step) pair) { return pair.Step(pair.Seed); }
      static void Main() {
        (int, Func<int, int>) local = (1, x => x + 1);
        (string, (int, Func<int, bool>))? nested = ("n", (2, x => x > 1));
        Console.WriteLine(local.Item2(local.Item1) + " " + Apply((5, x => x * 3)) + " " + nested.Value.Item2.Item2(nested.Value.Item2.Item1));
      }
    }`,
    'P',
    'Main',
  );
  // Each lambda is a delegate over its method; it used to be emitted as the element's default value - a null delegate.
  assert.equal(count(names, 'ldftn'), 3);
});

test('A02-T30 a static auto-property of an interface has accessors with bodies', () => {
  const output = run(`using System;
    interface ICounter { static int Created { get; private set; } static void Touch() { Created++; } }
    class P { static void Main() { ICounter.Touch(); ICounter.Touch(); Console.WriteLine(ICounter.Created); } }`);
  assert.equal(output, '2\n');
});

test('A02-T30 an interface that implements a member of its base interface is the most specific implementation', () => {
  const output = run(`using System;
    interface IA { string Who() { return "IA"; } int Size { get { return 1; } } }
    interface IB : IA { string IA.Who() { return "IB"; } int IA.Size { get { return 2; } } }
    interface IC : IB { abstract string IA.Who(); }
    class OnlyB : IB { }
    class Plain : IA { }
    class Deep : IC { string IA.Who() { return "Deep"; } }
    class P { static void Main() {
      IA[] all = { new OnlyB(), new Plain(), new Deep() };
      foreach (IA a in all) Console.WriteLine(a.Who() + " " + a.Size);
    } }`);
  assert.equal(output, 'IB 2\nIA 1\nDeep 2\n');
});

test('A02-T30 a static property or event of a class implements the static virtual member of its interface', () => {
  const result = emit(`using System;
    interface IShape<TSelf> where TSelf : IShape<TSelf> {
      static virtual int Sides { get { return 0; } }
      static virtual event Action Changed { add { } remove { } }
    }
    class Square : IShape<Square> { public static int Sides { get { return 4; } } public static event Action Changed { add { } remove { } } }
    class Blob : IShape<Blob> { }
    class P { static int Count<T>() where T : IShape<T> { return T.Sides; } static void Main() { Console.WriteLine(Count<Square>() + Count<Blob>()); } }`);
  // The CLR matches static members by MethodImpl rows only: one per accessor of the property and of the event.
  const inspector = new AssemblyInspector(result.assembly),
    square = inspector.types.find(candidate => candidate.name === 'Square'),
    bodies = (inspector.metadata.rows[25] ?? []).map(row => decodeCoded('MethodDefOrRef', row[1]));
  assert.deepEqual(bodies.map(token => square.methods.find(method => method.token === token)?.name).sort(), ['add_Changed', 'get_Sides', 'remove_Changed']);
});
