import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';

// SF-A02-T30: tuple element names through generic substitution, and the defects next to them that the stress family
// of the differential corpus exposed. The reduced programs are the corpus fixtures `reduced-tuples/names-through-
// generic-types`, `reduced-generics/generic-virtual-call-on-derived-receiver` and `reduced-conversions/in-operators-
// and-tuple-conversions` (pinned from Roslyn 5.3.0, run on .NET 10.0.5 by tests/compiler-stress-corpus.test.js).
// The direct-CIL VM has no tuples, so these tests check the binder's answer and the emitted IL.

const errorsOf = (source, options = {}) =>
  compileToAssembly(source, { name: 'Sample', ...options })
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => `${entry.code} ${entry.message}`);
const codesOf = (source, options) => errorsOf(source, options).map(text => text.slice(0, 6));

// Two of the defects are about what the base class library declares (the interfaces of ValueTuple, the members of
// KeyValuePair): those tests bind against the reference pack and are skipped where no .NET SDK is installed.
const pack = loadReferencePack(),
  skip = pack ? false : 'no .NET reference pack is installed',
  references = pack ? { references: pack.references } : {};

test('A02-T30 the element names of a tuple type survive the substitution of its type arguments', () => {
  assert.deepEqual(
    errorsOf(`using System;
    class Box<T> {
      T value;
      public Box(T value) { this.value = value; }
      public (T Value, int Depth) Pair() { return (value, 1); }
      public (int Cost, T Item)? Maybe(bool found) { return found ? (2, value) : null; }
    }
    static class Tools {
      public static (T Min, T Max) Both<T>(T a, T b) { return (a, b); }
      public static (TResult First, TResult Second) Map<T, TResult>(this (T, T) pair, Func<T, TResult> map) { return (map(pair.Item1), map(pair.Item2)); }
    }
    class P { static void Main() {
      var box = new Box<string>("x");
      var pair = box.Pair();
      Func<(string Value, int Depth), string> show = p => p.Value + p.Depth;
      Console.WriteLine(pair.Value + pair.Depth + show(pair) + Tools.Both(1, 2).Max + (1.5, 2.5).Map(v => (int)v).Second);
      Console.WriteLine(box.Maybe(true)?.Item.Length + box.Maybe(true).Value.Cost);
    } }`),
    [],
  );
  // A name the tuple does not have is still an error after substitution.
  assert.deepEqual(codesOf('class Box<T> { public (T Value, int Depth) Pair() { return default; } } class P { static void Main() { var x = new Box<int>().Pair().Other; } }'), ['CS1061']);
});

test('A02-T30 a tuple with element names satisfies the interface constraints of its ValueTuple', { skip }, () => {
  assert.deepEqual(
    errorsOf(`using System;
    class Graph<TNode> where TNode : IEquatable<TNode> { public bool Same(TNode a, TNode b) { return a.Equals(b); } }
    class P { static void Main() { Console.WriteLine(new Graph<(int X, int Y)>().Same((1, 2), (1, 2))); } }`,
      references,
    ),
    [],
  );
});

test('A02-T30 a generic extension Deconstruct takes its type arguments from the receiver', { skip }, () => {
  const extension = `static class Extensions {
      public static void Deconstruct<TKey, TValue>(this System.Collections.Generic.KeyValuePair<TKey, System.Collections.Generic.List<TValue>> pair, out TKey key, out int count, out TValue first) {
        key = pair.Key; count = pair.Value.Count; first = default(TValue);
      }
      public static void Deconstruct<TOther>(this string text, out int length, out TOther other) { length = text.Length; other = default(TOther); }
    }`;
  assert.deepEqual(
    errorsOf(`using System.Collections.Generic;
    ${extension}
    class P { static void Main() {
      var groups = new Dictionary<string, List<double>>();
      foreach (var (key, count, head) in groups) System.Console.WriteLine(key + count + head);
    } }`,
      references,
    ),
    [],
  );
  // A type parameter the receiver does not determine cannot be inferred from `out` variables: the method is no candidate.
  assert.ok(codesOf(`${extension} class P { static void Main() { var (length, other) = "text"; } }`, references).includes('CS8129'));
});

test('A02-T30 a generic virtual method called on a class that overrides it returns the constructed return type', () => {
  assert.deepEqual(
    errorsOf(`using System.Collections.Generic;
    interface IVisitor<out TResult> { TResult Visit(Node node); }
    abstract class Node { public abstract TResult Accept<TResult>(IVisitor<TResult> visitor); }
    sealed class Leaf : Node { public override TResult Accept<TResult>(IVisitor<TResult> visitor) { return visitor.Visit(this); } }
    sealed class Lister : IVisitor<List<Node>> { public List<Node> Visit(Node node) { return new List<Node> { node }; } }
    class P { static void Main() { var leaf = new Leaf(); System.Console.WriteLine(leaf.Accept(new Lister()).Count); } }`),
    [],
  );
});

test('A02-T30 an operand of an `in` parameter of a user-defined operator is passed by reference', () => {
  const result = compileToAssembly(
    `using System;
    struct M { public double A; public M(double a) { A = a; }
      public static M operator *(in M x, in M y) { return new M(x.A * y.A); }
      public static M One { get { return new M(1); } } }
    class P { static void Main() { var m = new M(2); var n = m * M.One; Console.WriteLine(n.A); } }`,
    { name: 'Sample' },
  );
  assert.deepEqual(result.diagnostics.filter(entry => entry.severity === 'error'), []);
  const inspector = new AssemblyInspector(result.assembly),
    main = inspector.types.find(type => type.name === 'P').methods.find(method => method.name === 'Main'),
    names = inspector.getMethod(main.token).instructions.map(instruction => instruction.name),
    call = names.lastIndexOf('call', names.indexOf('stloc.1'));
  // `m` by its address, `M.One` through a temporary: two addresses precede the call (values gave InvalidProgramException).
  assert.ok(names.slice(0, call).filter(name => name.startsWith('ldloca')).length >= 2, names.join(' '));
});

test('A02-T30 a tuple literal converts element by element before a user-defined conversion from a tuple', () => {
  assert.deepEqual(
    errorsOf(`struct Vec { public double X, Y; public Vec(double x, double y) { X = x; Y = y; }
      public static implicit operator Vec((double X, double Y) tuple) { return new Vec(tuple.X, tuple.Y); } }
    class P { static void Main() { int whole = 3; Vec a = (1.5, -2), b = (whole, whole * 2); System.Console.WriteLine(a.X + b.Y); } }`),
    [],
  );
});
