/**
 * Differential fixtures for SF-A02-T70 (C# 9 top-level statements): the synthesized entry point with `args`, `await`
 * and a return value, the `Program` class it lives in and the rules about where the statements may stand.
 * Rules that need several files (CS8802) are in tests/compiler-top-level.test.js.
 *
 * CS8803 is checked by the semantic analysis only: a program the execution pipeline compiles by itself is not
 * rejected for a type declared before its statements (many existing samples are written that way). The CS8803
 * fixtures therefore declare a struct, which puts them outside the execution profile.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('top-level', [
    out(
      'args-local-functions-and-return-value',
      cs`
    using System;
    Console.WriteLine(args.Length);
    int Add(int a, int b) => a + b;
    Console.WriteLine(Add(1, 2));
    if (args.Length > 5) return 1;
    return 0;
  `,
    ),
    out(
      'await-and-return-value',
      cs`
    using System;
    using System.Threading.Tasks;
    await Task.Delay(1);
    Console.WriteLine("done");
    return 3;
  `,
    ),
    out(
      'types-after-the-statements',
      cs`
    using System;
    int x = 5;
    Console.WriteLine(new Counter().Next() + x);
    static int Square(int v) => v * v;
    Console.WriteLine(Square(3));
    class Counter { int value; public int Next() => ++value; }
  `,
    ),
    out(
      'statements-are-members-of-partial-program',
      cs`
    using System;
    Console.WriteLine(Twice(4) + count);
    Console.WriteLine(Program.Twice(1));
    partial class Program
    {
        static int count = 1;
        public static int Twice(int v) => v * 2;
    }
  `,
    ),
    out(
      'labels-and-goto',
      cs`
    using System;
    int i = 0;
    again:
    i++;
    if (i < 3) goto again;
    Console.WriteLine(i);
  `,
    ),
    diag(
      'cs8803-statement-after-a-declaration',
      cs`
    using System;
    Console.WriteLine(1);
    namespace N { struct C { } }
    int x = 2;
    class D { }
    Console.WriteLine(x);
  `,
    ),
    diag(
      'cs8803-statement-after-a-type',
      cs`
    struct D { }
    System.Console.WriteLine(1);
  `,
    ),
    diag(
      'cs8801-locals-are-not-visible-in-types',
      cs`
    int x = 5;
    class C { int Get() => x; static void M() { Local(); } }
    void Local() { }
  `,
    ),
    diag(
      'cs0136-args-is-already-a-parameter',
      cs`
    int args = 1;
    System.Console.WriteLine(args);
  `,
    ),
    diag(
      'cs0260-program-must-be-partial',
      cs`
    System.Console.WriteLine(1);
    static class Program { }
  `,
    ),
    diag(
      'cs0101-program-must-be-a-class',
      cs`
    System.Console.WriteLine(1);
    struct Program { }
  `,
    ),
    diag(
      'cs8937-only-empty-statements',
      cs`
    ;
  `,
    ),
    diag(
      'cs7022-main-is-not-the-entry-point',
      cs`
    using System;
    Console.WriteLine(1);
    struct Other { static void Main() { } }
    static void Main() { }
  `,
    ),
    diag(
      'cs8321-a-program-of-one-unused-local-function',
      cs`
    void F() { }
  `,
    ),
    diag(
      'cs0029-cs0026-return-and-this',
      cs`
    System.Console.WriteLine(this);
    return "s";
  `,
    ),
  ]),
];
