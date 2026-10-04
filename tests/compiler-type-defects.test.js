import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, decodeCoded, MethodAttributes } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { runToEnd } from '../packages/compiler/test/differential/run-program.js';

// SF-A02-T30: defects in types, generics and conversions the stress family of the differential corpus exposed. The
// reduced programs are the corpus fixtures `reduced-types/*`, `reduced-generics/*` and `reduced-conversions/*`
// (pinned from Roslyn 5.3.0, run on .NET 10.0.5 by tests/compiler-stress-corpus.test.js); here the same defects are
// checked without a .NET SDK: no error, the output on the direct-CIL VM where its profile allows, else the IL.

function emit(source) {
  const result = compileToAssembly(source, { name: 'Sample' });
  assert.deepEqual(result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`), []);
  return result;
}

function run(source) {
  const outcome = runToEnd(new CilVirtualMachine(emit(source).assembly, { maxInstructions: 1_000_000, virtualTime: true }));
  assert.equal(outcome.state, 'terminated', String(outcome.fault?.message ?? outcome.state));
  return outcome.output;
}

const codesOf = source =>
  compileToAssembly(source, { name: 'Sample' })
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => entry.code);

test('A02-T30 the constructor of a readonly struct assigns its fields (no CS1604)', () => {
  // (The direct-CIL VM has no writable addresses of readonly struct fields: the program is emitted, .NET runs the fixture.)
  emit(`using System;
    readonly struct Pair { public readonly int X, Y; private readonly int sum; public Pair(int x, int y) { X = x; Y = y; this.sum = x + y; } public int Sum { get { return sum; } } }
    class P { static void Main() { Console.WriteLine(new Pair(3, 4).Sum); } }`);
  // Any other member of a readonly struct still cannot assign them.
  assert.deepEqual(codesOf('readonly struct S { readonly int x; public S(int v) { x = v; } public void M() { this = default; } } class P { static void Main() { } }'), ['CS1604']);
});

test('A02-T30 records: a sealed ToString is inherited, PrintMembers of a base record can be overridden', () => {
  assert.deepEqual(
    codesOf(`using System.Text;
    abstract record Event(int At) { public abstract string Describe(); public sealed override string ToString() { return At + " " + Describe(); } }
    sealed record Borrowed(int At, string Title) : Event(At) { public override string Describe() { return Title; } }
    record Animal(string Name);
    record Bird(string Name, bool Flies) : Animal(Name) { protected override bool PrintMembers(StringBuilder builder) { builder.Append(Name); return true; } }
    class P { static void Main() { System.Console.WriteLine(new Borrowed(1, "t").ToString() + new Bird("b", true)); } }`),
    [],
  );
  // An `override` that overrides nothing is still an error in a record.
  assert.deepEqual(codesOf('record A(int X); record B(int X) : A(X) { protected override bool Other(int x) { return true; } } class P { static void Main() { } }'), ['CS0115']);
});

test('A02-T30 base.M<T>() calls the nearest override of a generic virtual method', () => {
  const result = emit(`using System;
    abstract class Serializer { public abstract string Write<T>(T value); }
    class Plain : Serializer { public override string Write<T>(T value) { return value.ToString(); } }
    class Typed : Plain { public override string Write<T>(T value) { return "t:" + base.Write(value); } }
    class P { static void Main() { Serializer s = new Typed(); Console.WriteLine(s.Write(42)); } }`);
  const inspector = new AssemblyInspector(result.assembly),
    typed = inspector.types.find(type => type.name === 'Typed'),
    write = typed.methods.find(method => method.name === 'Write'),
    calls = inspector.getMethod(write.token).instructions.filter(instruction => instruction.name === 'call').map(instruction => inspector.resolveToken(instruction.operand));
  assert.ok(calls.some(target => target.owner === 'Plain' && target.name === 'Write'), 'the call names Plain::Write, not the abstract Serializer::Write');
});

test('A02-T30 a nested type of a constructed type is named in an expression and in a signature', () => {
  const result = emit(`using System;
    static class Outer<TKey> {
      public sealed class Cache<TValue> { public static string Describe() { return typeof(TKey).Name + "," + typeof(TValue).Name; } public int Size() { return 1; } }
      public static Cache<TValue> Create<TValue>() { return new Cache<TValue>(); }
    }
    class P { static void Main() { Console.WriteLine(Outer<string>.Cache<int>.Describe() + " " + Outer<int>.Create<string>().Size()); } }`);
  // `Cache<TValue>` named inside `Outer<TKey>` is `Outer<TKey>.Cache<TValue>`; .NET rejected the one-argument form
  // ("used with the wrong number of generic arguments"). The corpus fixture runs it; here it binds and emits.
  assert.ok(result.assembly.length > 0);
});

test('A02-T30 sizeof of an enum is a constant; a `struct, Enum` constraint has Enum as its base class', () => {
  const output = run(`using System;
    enum Small : sbyte { A } enum Wide : long { A } enum Plain { A }
    class P {
      const int Size = sizeof(Wide) * 2;
      static T Same<T>(T value) where T : struct, Enum { return value; }
      static T Forward<T>(T value) where T : struct, Enum { return Same(value); }
      static void Main() { Console.WriteLine(sizeof(Small) + " " + sizeof(Plain) + " " + Size + " " + Forward(Plain.A)); }
    }`);
  assert.equal(output, '1 4 16 A\n');
});

test('A02-T30 a method group compared with a delegate, and a constant through a user-defined conversion', () => {
  const output = run(`using System;
    delegate int Transform(int value);
    sealed class Natural {
      public readonly ulong Value; Natural(ulong value) { Value = value; }
      public static implicit operator Natural(ulong value) { return new Natural(value); }
      public static Natural operator +(Natural a, Natural b) { return new Natural(a.Value + b.Value); }
    }
    class P {
      static int Double(int x) { return x * 2; }
      static int Other(int x) { return x; }
      static void Main() {
        Natural one = 1, sum = one + 41;
        Console.WriteLine(sum.Value);
      }
      static bool Compare(Transform doubler) { return doubler == Double && !(doubler == Other) && Double != doubler; }
    }`);
  assert.equal(output, '42\n');
  // A negative constant does not convert to ulong, so the conversion does not apply.
  assert.deepEqual(codesOf('class N { public static implicit operator N(ulong v) { return null; } } class P { static void Main() { N n = -1; } }'), ['CS0029']);
});

test('A02-T30 `value ?? other` where value is a type parameter', () => {
  const output = run(`using System;
    class P {
      static T Or<T>(T value, T other) where T : class { return value ?? other; }
      static T OrThrow<T>(T value) where T : class { return value ?? throw new Missing(); }
      static void Main() {
        Console.WriteLine(Or("a", "b") + Or(null, "b") + OrThrow("c"));
        try { OrThrow<string>(null); } catch (Missing) { Console.WriteLine("thrown"); }
      }
    }
    class Missing : Exception { }`);
  assert.equal(output, 'abc\nthrown\n');
});

test('A02-T30 an override with a covariant return type has its own slot and a MethodImpl row', () => {
  const result = emit(`using System;
    abstract class Shape { public abstract Shape Clone(); public virtual object Tag { get { return "s"; } } }
    class Circle : Shape { public override Circle Clone() { return new Circle(); } public override string Tag { get { return "c"; } } }
    class P { static void Main() { Shape s = new Circle(); Console.WriteLine(s.Clone().Tag); } }`);
  const inspector = new AssemblyInspector(result.assembly),
    circle = inspector.types.find(type => type.name === 'Circle'),
    rows = (inspector.metadata.rows[25] ?? []).map(row => [decodeCoded('MethodDefOrRef', row[1]), inspector.resolveToken(decodeCoded('MethodDefOrRef', row[2]))]);
  for (const name of ['Clone', 'get_Tag']) {
    const method = circle.methods.find(candidate => candidate.name === name),
      row = rows.find(([body]) => body === method.token);
    assert.ok(method.flags & MethodAttributes.NewSlot, `${name} is newslot`);
    assert.equal(row?.[1].owner + '::' + row?.[1].name, 'Shape::' + name);
  }
});
