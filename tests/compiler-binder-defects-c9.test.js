/**
 * Three binder defects reported against the C# 9-12 rules. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/binder-defects-c9.js; these tests cover the boundaries and the limit
 * that stays (structs are not executable).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

const csharpErrors = source =>
  compile(source)
    .diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS'))
    .map(d => `${d.code}@${d.start}`);

test('an object initializer of a struct assigns members of a new variable: no CS1612', () => {
  const source = `struct V {
  public int X;
  public int P { get; set; }
  public static V operator +(V a, V b) => new V { X = a.X + b.X, P = 1 };
  public V Twice() => new V { X = X * 2 };
}
class Holder { public V Field; }
class Program { static void Main() { var h = new Holder { Field = { X = 1 } }; var v = new V { X = 2 } + new V(); } }
`;
  assert.deepEqual(csharpErrors(source), []);
  // Limit: the runtime has no structs, so the program is valid C# that is not executable here.
  assert.match(notExecutable(source).message, /struct/);
});

test('a member of a struct value that is not a variable is still CS1612; a struct property in an initializer is CS1918', () => {
  const source = `struct V { public int X; }
class Holder { public V Property { get; set; } public static V Make() => new V(); }
class Program { static void Main() { Holder.Make().X = 1; var h = new Holder { Property = { X = 5 } }; } }
`;
  assert.deepEqual(csharpErrors(source), [`CS1612@${source.indexOf('Holder.Make().X')}`, `CS1918@${source.indexOf('Property = {')}`]);
});

test('optional parameters of a primary constructor supply the omitted arguments', () => {
  const source = `using System;
record Named(string Name = "n", int Rank = 2);
class Counter(int start = 10, int step = 1) { public int Next() => start += step; }
class Scaled(double factor = 1.5, bool on = true, string text = null, int sum = 2 + 3)
{
  public string Text() => factor + " " + on + " " + (text == null) + sum;
}
class Program {
  static void Main() {
    Console.WriteLine(new Named().Name + new Named().Rank);
    Console.WriteLine(new Named(Rank: 7));
    Console.WriteLine(new Counter().Next() + " " + new Counter(step: 5).Next());
    Console.WriteLine(new Scaled().Text());
  }
}
`;
  assert.deepEqual(linesOf(source), ['n2', 'Named { Name = n, Rank = 7 }', '11 15', '1.5 True True5']);
});

test('a default of a primary constructor parameter must be a constant of the parameter type', () => {
  const source = `record Wrong(string Name = 5);
record NotConstant(int Value = Program.Compute());
class Program { public static int Compute() => 1; static void Main() { } }
`;
  assert.deepEqual(csharpErrors(source), [`CS1750@${source.indexOf('Name')}`, `CS1736@${source.indexOf('Program.Compute()')}`]);
});

test('lambdas and anonymous methods are elements of explicitly typed array initializers', () => {
  const source = `using System;
class Program {
  static Func<int, int>[] steps = { x => x + 1, x => x * 2 };
  static void Main() {
    int offset = 3;
    Func<int, int>[] local = { x => x + offset, delegate (int x) { return x - offset; } };
    Func<int, int>[][] nested = { new Func<int, int>[] { x => -x }, new Func<int, int>[0] };
    Console.WriteLine(steps[0](4) + " " + steps[1](4));
    Console.WriteLine(local[0](4) + " " + local[1](4));
    Console.WriteLine(nested[0][0](4) + " " + nested[1].Length);
  }
}
`;
  assert.deepEqual(linesOf(source), ['5 8', '7 1', '-4 0']);
});

test('a lambda element that does not fit the element type is reported on the element', () => {
  const source = `using System;
class Program { static void Main() { Func<int, int>[] wrong = { x => "text", (string s) => 1 }; } }
`;
  const codes = csharpErrors(source).map(entry => entry.split('@')[0]);
  assert.deepEqual(codes.sort(), ['CS0029', 'CS1661', 'CS1662', 'CS1678']);
});
