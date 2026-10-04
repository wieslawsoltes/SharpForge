import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToAssembly } from '@sharpforge/compiler';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { runToEnd } from '../packages/compiler/test/differential/run-program.js';

// SF-A02-T30: pattern defects the stress family of the differential corpus exposed - false errors on valid programs
// and two wrong results. The reduced programs are the corpus fixtures `reduced-patterns/*` (pinned from Roslyn 5.3.0,
// run on .NET 10.0.5 by tests/compiler-stress-corpus.test.js); here the same defects are checked without a .NET SDK:
// no error is reported, and where the direct-CIL VM can run the program (its profile has no Nullable<T>) the output.

const errorsOf = source =>
  compileToAssembly(source, { name: 'Sample' })
    .diagnostics.filter(entry => entry.severity === 'error')
    .map(entry => `${entry.code} ${entry.message}`);

function run(source) {
  const result = compileToAssembly(source, { name: 'Sample' });
  assert.deepEqual(result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code} ${entry.message}`), []);
  const outcome = runToEnd(new CilVirtualMachine(result.assembly, { maxInstructions: 1_000_000, virtualTime: true }));
  assert.equal(outcome.state, 'terminated', String(outcome.fault?.message ?? outcome.state));
  return outcome.output;
}

test('A02-T30 a switch expression arm may throw (no CS8115)', () => {
  const output = run(`using System;
    class BadRank : Exception { }
    class P {
      static string Rank(int rank) { return rank switch { 1 => "ace", >= 2 and <= 10 => "pip", _ => throw new BadRank() }; }
      static void Main() {
        Console.WriteLine(Rank(1) + Rank(5));
        try { Rank(0); } catch (BadRank) { Console.WriteLine("rank"); }
      }
    }`);
  assert.equal(output, 'acepip\nrank\n');
  // A throw expression is still refused where it was: as an operand of a binary operator or an argument.
  const refused = errorsOf('class P { static void F(int x) { } static void Main() { F(throw new System.Exception()); } }');
  assert.deepEqual([...new Set(refused.map(text => text.slice(0, 6)))], ['CS8115']);
});

test('A02-T30 `x is A.B` is a constant pattern when A.B is a constant and not a type', () => {
  const output = run(`using System;
    enum Access { None, Read, Write }
    static class Limits { public const int Max = 10; }
    namespace N { class T { } }
    class P {
      static void Main() {
        object boxed = Access.Read; Access access = Access.Write; int n = 10; object t = new N.T();
        Console.WriteLine((boxed is Access.Read) + " " + (boxed is Access.Write) + " " + (access is Access.Write) + " " + (n is Limits.Max) + " " + (t is N.T) + " " + (boxed is Access.Read | false));
      }
    }`);
  assert.equal(output, 'True False True True True True\n');
  assert.deepEqual(errorsOf('class P { static void Main() { object o = 1; bool b = o is Missing.Name; } }').map(text => text.slice(0, 6)), ['CS0246']);
});

test('A02-T30 a constant pattern over an object compares a value of the constant type', () => {
  const output = run(`using System;
    enum Access { None, Read, Write }
    class P {
      static string Kind(object o) { return o switch { 5 => "five", Access.Write => "write", 'c' => "char", true => "yes", "s" => "text", null => "null", _ => "other" }; }
      static bool IsFive<T>(T value) { return value is 5; }
      static void Main() {
        Console.WriteLine(Kind(5) + " " + Kind(5L) + " " + Kind(Access.Write) + " " + Kind('c') + " " + Kind(true) + " " + Kind("s") + " " + Kind(null) + " " + Kind(Access.Read));
        Console.WriteLine(IsFive(5) + " " + IsFive(6) + " " + IsFive("5"));
      }
    }`);
  assert.equal(output, 'five other write char yes text null other\nTrue False False\n');
});

test('A02-T30 the pattern after `and` sees the type the left pattern narrowed the input to', () => {
  const output = run(`using System;
    class P {
      static string Narrow(object value) {
        return value is int and < 0 and var negative ? "negative " + negative * 2 : value is string { Length: > 2 } and var text ? "text " + text.ToUpper() : "other";
      }
      static void Main() { Console.WriteLine(Narrow(-4) + "; " + Narrow(4) + "; " + Narrow("abc") + "; " + Narrow("ab")); }
    }`);
  assert.equal(output, 'negative -8; other; text ABC; other\n');
});

test('A02-T30 patterns over a nullable value type bind against its value', () => {
  assert.deepEqual(
    errorsOf(`using System;
    enum State { Created, Paid }
    struct Point { public int X; public int Y; public void Deconstruct(out int x, out int y) { x = X; y = Y; } }
    class P {
      static State? Next(State state, int trigger) { return (state, trigger) switch { (State.Created, 1) => State.Paid, _ => null }; }
      static string Age(int? value) { return value switch { null => "unknown", < 18 => "minor", >= 18 and < 65 => "adult", var v => "senior " + v }; }
      static string Fire(State state) { State? target = Next(state, 1); if (target is not { } next) return "ignored"; State copy = next; return copy.ToString(); }
      static string Show(Point? point) { return point switch { { X: 0 } => "x0", (var x, 0) => "y0 " + x, { } p => "point " + p.X, null => "nothing" }; }
      static (int Cost, string Path)? Route(bool found) { return found ? (7, "a") : null; }
      static void Main() {
        var route = Route(true);
        Console.WriteLine(Age(5) + Fire(State.Created) + Show(null) + (route is var (cost, path) ? cost + path : "none"));
      }
    }`),
    [],
  );
});

test('A02-T30 `x is var v` always matches: v is assigned where the test is false', () => {
  assert.deepEqual(
    errorsOf(`using System;
    class P {
      static double Ratio(double value) { return value is var d && d == 0 ? double.NaN : 1 / d; }
      static int First(int[] values) { if (!(values.Length is var n) || n == 0) return n; return values[0]; }
      static void Main() { Console.WriteLine(Ratio(4) + First(new[] { 1 })); }
    }`),
    [],
  );
  // A pattern that can fail still leaves its variable unassigned on the false branch.
  assert.deepEqual(
    errorsOf('class P { static int F(object o) { return o is int i && i > 0 ? 1 : i; } static void Main() { F(1); } }').map(text => text.slice(0, 6)),
    ['CS0165'],
  );
});
