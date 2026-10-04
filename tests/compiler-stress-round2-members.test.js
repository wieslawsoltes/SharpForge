import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// SF-A02-T30, stress round 2 (third batch): defects found by the round-2 stress programs, checked here without a
// .NET SDK. What the programs print on real .NET is pinned from Roslyn 5.3.0 in the reduced programs named in each
// test (packages/compiler/test/differential/fixtures/reduced/, run by tests/compiler-stress-corpus.test.js).

const errorsOf = source =>
  analyze([parse(new SourceText(source, 'Program.cs'))], {})
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => entry.code);

/** The instructions of `type::method` as text: `opcode` or `opcode Owner::Member`. */
function instructionsOf(source, typeName, methodName) {
  const result = compileToAssembly(source, { name: 'Sample' }),
    errors = result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`);
  assert.deepEqual(errors, []);
  const inspector = new AssemblyInspector(result.assembly),
    type = inspector.types.find(candidate => candidate.name === typeName),
    method = type.methods.find(candidate => candidate.name === methodName);
  return inspector.getMethod(method.token).instructions.map(instruction => {
    if (instruction.operandKind !== 'token' || instruction.operand >>> 24 === 0x70) return instruction.name;
    const target = inspector.resolveToken(instruction.operand);
    return `${instruction.name} ${target.owner ?? ''}::${target.name}`;
  });
}

const tally = 'struct Tally { public int Count; public void Increment() { Count++; } public readonly int Peek() => Count; }';

test('A02-T30 a mutating call on a struct in a read-only variable acts on a copy (reduced-types/defensive-copies-and-ref-struct-constraints)', () => {
  const source = `${tally}
    class P {
      static int In(in Tally t) { t.Increment(); return t.Count; }
      static int Own(Tally t) { t.Increment(); return t.Count; }
      static int Read(in Tally t) => t.Peek();
      static void Main() { }
    }`;
  const copies = body => body.some((name, index) => /^stloc/.test(name) && /^ldloca/.test(body[index + 1] ?? '') && /Increment|Peek/.test(body[index + 2] ?? ''));
  assert.equal(copies(instructionsOf(source, 'P', 'In')), true, 'an `in` parameter is copied before a mutating call');
  assert.equal(copies(instructionsOf(source, 'P', 'Own')), false, 'a value parameter is the variable');
  assert.equal(copies(instructionsOf(source, 'P', 'Read')), false, 'a readonly member needs no copy');
});

test('A02-T30 variables a case guard assigns are assigned in the section (reduced-patterns/guard-variables-and-nullable-narrowing)', () => {
  const source = `class P {
      static bool Find(string name, out int found) { found = name.Length; return found > 0; }
      static int M(string text) {
        switch (text) {
          case { Length: > 2 } t when t.Length - 2 is > 0 and var split: return split;
          case var name when Find(name, out int found): return found;
          default: return -1;
        } } }`;
  assert.deepEqual(errorsOf(source), []);
  // Two labels on one section: neither guard's variables are assigned there.
  const shared = `class P { static int M(object o) {
      switch (o) { case int a when a is var x: case string s when s.Length is var x2: return 0; default: return 1; } } }`;
  assert.deepEqual(errorsOf(shared), []);
  assert.deepEqual(errorsOf('class P { static int M(object o) { switch (o) { case string s when s.Length > 0 || s.Length is var n: return n; } return 0; } }'), ['CS0165']);
});

test('A02-T30 a relational pattern narrows a nullable input for the pattern after `and`', () => {
  const source = `class P { static decimal M(decimal? percent, int? uses) {
      if (percent is > 0m and <= 50m and var p && uses is 3 and var u) return p * u;
      return 0m;
    } }`;
  assert.deepEqual(errorsOf(source), []);
  // `not null and var raw` does not narrow: Roslyn keeps `decimal?` there.
  assert.deepEqual(errorsOf('class P { static decimal M(decimal? percent) { if (percent is not null and var raw) return raw; return 0m; } }'), ['CS0266']);
});

test('A02-T30 constraints take part in overload resolution: a candidate that violates them loses to one that does not', () => {
  const source = `using System;
    class P {
      static string Kind<T>(T value) where T : struct, IComparable<T> => "value";
      static string Kind<T>(T value, int unused = 0) where T : class => "reference";
      static string M() => Kind(5) + Kind("text");
    }`;
  assert.deepEqual(errorsOf(source), []);
  // A lone candidate that violates its constraint is still reported.
  assert.deepEqual(errorsOf('class P { static void F<T>(T value) where T : class { } static void M() { F(5); } }'), ['CS0452']);
});

test('A02-T30 explicit interface events, declared copy constructors, tuple element names in patterns, tuple == default', () => {
  const source = `using System;
    interface IFeed { event Action<string> Closed; }
    class Ticker : IFeed {
      Action<string> handlers;
      public event Action<string> Closed;
      event Action<string> IFeed.Closed { add { handlers += value; } remove { handlers -= value; } }
      public void Fire() { Closed?.Invoke("p"); handlers?.Invoke("i"); }
    }
    record Document(string Title) {
      private Document(Document original) { Title = original.Title; }
    }
    class P {
      static string M((int X, int Y) point, object boxed) {
        (int Row, int Column) best = default;
        if (best == default && point is { X: 0, Y: var y }) return "x0 " + y;
        return boxed is ValueTuple<int, int> { Item1: > 0 } ? "positive" : "other";
      }
    }`;
  assert.deepEqual(errorsOf(source), []);
  // A constructor of a positional record that is not the copy constructor still has to chain to `this`.
  assert.deepEqual(errorsOf('record R(int A) { public R(string text) { A = 1; } }'), ['CS8862']);
});
