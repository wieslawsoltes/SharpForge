import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { VirtualMachine } from '@sharpforge/runtime';
import { SharedEvaluations } from '../packages/compiler/src/lowering/decision-dag.js';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

const program = body => `using System;\nclass Program {\n${body}\n}\n`;

test('SF-A02-T08.2 shared evaluations: one input per access path, however many tests read it', () => {
  let temps = 0;
  const decision = new SharedEvaluations({
    temp: (type, hint) => ({ name: hint + temps++, type }),
    assign: (target, value) => ({ assign: [target, value] }),
    local: variable => ({ local: variable.name }),
    literal: value => ({ literal: value }),
    conditional: (condition, whenTrue, whenFalse) => ({ condition, whenTrue, whenFalse }),
    sequence: (locals, effects, value) => ({ effects, value }),
  });
  const root = decision.root(null, () => ({ local: 'p' }));
  let builds = 0;
  const x1 = decision.member(root, 'X', null, 'int', () => ({ built: ++builds }));
  const x2 = decision.member(root, 'X', null, 'int', () => ({ built: ++builds }));
  const y = decision.member(root, 'Y', null, 'int', () => ({ built: ++builds }));
  const nested = decision.member(x1, 'Z', null, 'int', () => ({ built: ++builds }));
  assert.equal(x1, x2, 'the same path is the same input');
  assert.notEqual(x1, y);
  assert.equal(nested.key, '.X.Z');
  assert.equal(decision.evaluations, 3);
  assert.equal(decision.locals.length, 6, 'a value and a flag per input');
  assert.equal(decision.resets.length, 3, 'every flag is reset before the first test');
  // A read is "flag ? value : (value = build, flag = true, value)".
  const read = x1.read();
  assert.deepEqual(read.whenTrue, { local: 'member0' });
  assert.equal(read.whenFalse.effects.length, 2);
});

test('SF-A02-T08.2 a property tested by several arms is read once per switch', () => {
  const lines = linesOf(`
    using System;
    class Shape {
      public static int Reads;
      int sides;
      public Shape(int sides) { this.sides = sides; }
      public int Sides { get { Reads++; return sides; } }
    }
    class Program {
      static string Name(Shape s) => s switch { { Sides: 3 } => "triangle", { Sides: 4 } => "square", { Sides: > 4 and < 7 } => "few", _ => "many" };
      static void Main() {
        Console.WriteLine(Name(new Shape(3)) + Shape.Reads);
        Console.WriteLine(Name(new Shape(4)) + Shape.Reads);
        Console.WriteLine(Name(new Shape(6)) + Shape.Reads);
        Console.WriteLine(Name(new Shape(9)) + Shape.Reads);
      }
    }`);
  assert.deepEqual(lines, ['triangle1', 'square2', 'few3', 'many4']);
});

test('SF-A02-T08.2 the governing expression of a switch is evaluated once', () => {
  const lines = linesOf(
    program(`
      static int calls;
      static int Next() { calls++; return 3; }
      static void Main() {
        string size = Next() switch { 1 => "one", 2 => "two", 3 => "three", _ => "?" };
        switch (Next()) { case 1: size += "!"; break; case 3: size += "?"; break; }
        Console.WriteLine(size + calls);
      }`),
  );
  assert.deepEqual(lines, ['three?2']);
});

test('SF-A02-T08.2 patterns: constants, relational, and/or/not, var, nested properties and when clauses', () => {
  const lines = linesOf(`
    using System;
    class Inner { public int Level { get; set; } }
    class Outer { public Inner Inner { get; set; } public string Tag; }
    class Program {
      static string Check(Outer o) {
        if (o is null) return "null";
        if (o is { Inner: null }) return "empty";
        if (o is { Tag: "x", Inner: { Level: > 5 } }) return "deep x";
        if (o is { Inner: { Level: var level } } && level is 1 or 2) return "low " + level;
        if (o is not { Tag: "skip" }) return "other";
        return "skipped";
      }
      static void Main() {
        Console.WriteLine(Check(null));
        Console.WriteLine(Check(new Outer()));
        Console.WriteLine(Check(new Outer { Tag = "x", Inner = new Inner { Level = 9 } }));
        Console.WriteLine(Check(new Outer { Tag = "y", Inner = new Inner { Level = 2 } }));
        Console.WriteLine(Check(new Outer { Tag = "y", Inner = new Inner { Level = 7 } }));
        Console.WriteLine(Check(new Outer { Tag = "skip", Inner = new Inner { Level = 7 } }));
        int n = 15;
        string kind = n switch { < 0 => "negative", var v when v % 15 == 0 => "fizzbuzz", var v when v % 3 == 0 => "fizz", _ => "plain" };
        Console.WriteLine(kind);
      }
    }`);
  assert.deepEqual(lines, ['null', 'empty', 'deep x', 'low 2', 'other', 'skipped', 'fizzbuzz']);
});

test('SF-A02-T08.2 a switch expression without a matching arm throws', () => {
  const result = compile(program(`static void Main() { int n = 5; string s = n switch { 1 => "one", 2 => "two" }; Console.WriteLine(s); }`));
  assert.equal(result.success, true);
  assert.ok(result.diagnostics.some(d => d.code === 'CS8509'), 'the missing arm is a warning');
  const run = new VirtualMachine(result.image).run();
  assert.equal(run.state, 'faulted');
});

test('SF-A02-T08.2 a type pattern that needs a run-time type check is reported, not miscompiled', () => {
  const reported = notExecutable(program(`static void Main() { object o = 5; if (o is string s) Console.WriteLine(s); }`));
  assert.match(reported.message, /runtime type check/);
});

test('SF-A02-T10 instance initializers run in the constructor that does not chain, after its arguments', () => {
  const lines = linesOf(`
    using System;
    class Log { public static string Text = ""; public static int Add(string s) { Text += s; return Text.Length; } }
    class Item {
      int a = Log.Add("a");
      public int B { get; set; } = Log.Add("b");
      public Item() : this(Log.Add("x")) { Log.Add("p"); }
      public Item(int value) { Log.Add("v"); }
    }
    class Bare { int c = Log.Add("c"); public int D = Log.Add("d"); }
    class Program {
      static void Main() {
        new Item();
        Console.WriteLine(Log.Text);
        Log.Text = "";
        var item = new Item(1) { B = Log.Add("i") };
        new Bare();
        Console.WriteLine(Log.Text + item.B);
      }
    }`);
  assert.deepEqual(lines, ['xabvp', 'abvicd4']);
});

test('SF-A02-T10 static initializers run on first use; a static constructor runs before any member is used', () => {
  const lines = linesOf(`
    using System;
    class Log { public static string Text = ""; public static int Add(string s) { Text += s; return Text.Length; } }
    class Lazy { public static int Value = Log.Add("L"); public static int Twice() { return 2; } }
    class Eager {
      public static int Value = Log.Add("E");
      static Eager() { Log.Add("C"); }
      public static int Twice() { return 2; }
    }
    class Program {
      static void Main() {
        Log.Add("1");
        Lazy.Twice();
        Log.Add("2");
        Eager.Twice();
        Log.Add("3");
        Console.WriteLine(Log.Text);
        Console.WriteLine(Lazy.Value + Eager.Value);
        Console.WriteLine(Log.Text);
      }
    }`);
  assert.deepEqual(lines, ['12EC3', '9', '12EC3L']);
});

test('SF-A02-T10.1/T10.3 properties, const and readonly fields execute; writing a getter-only property is CS0200', () => {
  const lines = linesOf(`
    using System;
    class Circle {
      public const double Pi = 3.0;
      readonly int radius;
      public Circle(int radius) { this.radius = radius; Scale = 2; }
      public int Scale { get; }
      public double Area => Pi * radius * radius * Scale;
      public static int Count { get; private set; }
      public int Diameter { get { return radius * 2; } set { Count = value; } }
    }
    class Program { static void Main() { var c = new Circle(2); c.Diameter = 7; Console.WriteLine(c.Area + " " + c.Diameter + " " + Circle.Count); } }`);
  assert.deepEqual(lines, ['24 4 7']);
  const invalid = compile(`class C { public int P { get; } void M() { P = 1; } static void Main() { } }`);
  assert.ok(invalid.diagnostics.some(d => d.code === 'CS0200'));
});

test('SF-A02-T10.2 user-defined indexers with one and several parameters', () => {
  const lines = linesOf(`
    using System;
    class Table {
      int[] cells = new int[6];
      public int this[int row, int column] { get { return cells[row * 3 + column]; } set { cells[row * 3 + column] = value; } }
      public int this[int index] { get { return cells[index]; } }
    }
    class Program { static void Main() { var t = new Table(); t[1, 2] = 9; t[0, 0] = t[1, 2] + 1; Console.WriteLine(t[5] + " " + t[0]); } }`);
  assert.deepEqual(lines, ['9 10']);
});

test('SF-A02-T10.6 object initializers assign members in order on the new object', () => {
  const lines = linesOf(`
    using System;
    class Box { public int Width; public int Height { get; set; } public string Label { get; set; } = "none"; }
    class Program {
      static string order = "";
      static int Mark(string s, int v) { order += s; return v; }
      static void Main() {
        var box = new Box { Height = Mark("h", 2), Width = Mark("w", 3) };
        Console.WriteLine(box.Width * box.Height + box.Label + order);
      }
    }`);
  assert.deepEqual(lines, ['6nonehw']);
});

test('arguments: named arguments are evaluated in source order, defaults and params are filled in', () => {
  const lines = linesOf(
    program(`
      static string order = "";
      static int Mark(string s, int v) { order += s; return v; }
      static int Sum(int a, int b = 10, params int[] rest) { int s = a + b; foreach (int r in rest) s += r; return s; }
      static void Main() {
        Console.WriteLine(Sum(1));
        Console.WriteLine(Sum(1, 2, 3, 4));
        Console.WriteLine(Sum(b: Mark("b", 5), a: Mark("a", 1)));
        Console.WriteLine(order);
      }`),
  );
  assert.deepEqual(lines, ['11', '10', '6', 'ba']);
});
