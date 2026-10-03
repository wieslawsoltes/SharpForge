/**
 * Differential fixtures for SF-A02-T08.1 - T08.3 (patterns): positional and list patterns, and the subsumption and
 * exhaustiveness diagnostics. The output programs run from the semantic code generator; the pinned output is what
 * the same program prints on .NET.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('pattern-lowering', [
    out(
      'positional-patterns-over-tuples-records-and-deconstruct',
      cs`
    using System;
    record Point(int X, int Y);
    class Pair
    {
        public static int Calls;
        public int A; public int B;
        public void Deconstruct(out int a, out int b) { Calls++; a = A; b = B; }
    }
    class Program
    {
        static string Where(Point p) => p switch
        {
            (0, 0) => "origin",
            (var x, 0) => "x-axis " + x,
            (0, var y) => "y-axis " + y,
            Point(var x, var y) { X: > 10 } => "far " + (x + y),
            _ => "plane",
        };
        static string Kind((int, string) t) => t switch { (0, null) => "empty", (> 0, var s) => "pos " + s, var (n, s) => n + "/" + s };
        static void Main()
        {
            Console.WriteLine(Where(new Point(0, 0)) + "," + Where(new Point(3, 0)) + "," + Where(new Point(0, 4)) + "," + Where(new Point(11, 1)) + "," + Where(new Point(1, 1)));
            Console.WriteLine(Kind((0, null)) + "," + Kind((2, "two")) + "," + Kind((-1, "neg")));
            var pair = new Pair(); pair.A = 1; pair.B = 2;
            if (pair is (1, var b)) Console.WriteLine(b);
            Console.WriteLine(pair switch { (0, _) => "zero", (1, 3) => "no", (1, 2) => "yes", _ => "other" });
            Console.WriteLine(Pair.Calls);
            int a = 1, c = 2;
            Console.WriteLine((a, c) switch { (1, 2) => "x", _ => "y" });
            var nested = (1, (2, "three"));
            if (nested is (1, (var two, { Length: 5 }))) Console.WriteLine(two);
            Point none = null;
            Console.WriteLine(none is (0, 0));
            Console.WriteLine(none is var (p, q) ? "match" : "null");
            switch (pair)
            {
                case (2, _): Console.WriteLine("two"); break;
                case (1, var second) when second > 1: Console.WriteLine("one then " + second); break;
                default: Console.WriteLine("default"); break;
            }
        }
    }
  `,
    ),
    out(
      'list-patterns-over-arrays',
      cs`
    using System;
    class Program
    {
        static string Shape(int[] a) => a switch
        {
            null => "null",
            [] => "empty",
            [1] => "one",
            [1, .., 9] => "1..9",
            [_, 2, ..] => "second is 2",
            [.., var last] => "ends " + last,
        };
        static void Main()
        {
            Console.WriteLine(Shape(null) + "," + Shape(new int[0]) + "," + Shape(new[] { 1 }) + "," + Shape(new[] { 1, 5, 9 }) + "," + Shape(new[] { 7, 2, 3 }) + "," + Shape(new[] { 4, 5 }));
            int[] arr = { 1, 2, 3, 4 };
            if (arr is [1, .. var rest, 4]) Console.WriteLine(rest.Length + " " + rest[0] + rest[1]);
            if (arr is [.. var all]) Console.WriteLine(all.Length + " " + (all == arr));
            if (arr is [var first, .. [2, 3], _] whole) Console.WriteLine(first + whole.Length);
            string[] words = { "a", "b" };
            Console.WriteLine(words is ["a", var w] ? w : "?");
            Console.WriteLine(arr is [> 0, <= 2, ..]);
            Console.WriteLine(arr is [_, _]);
            (int, int)[] pairs = { (1, 2), (3, 4) };
            if (pairs is [(1, var x), .., (_, var y)]) Console.WriteLine(x + y);
        }
    }
  `,
    ),
    diag(
      'positional-and-list-errors',
      cs`
    class Plain { }
    class Pair { public void Deconstruct(out int a, out int b) { a = 1; b = 2; } }
    class Program
    {
        static void Main()
        {
            var t = (1, 2);
            var plain = new Plain();
            var pair = new Pair();
            int[] a = { 1 };
            System.Console.WriteLine(t is (1, 2, 3));
            System.Console.WriteLine(plain is (1, 2));
            System.Console.WriteLine(pair is (1, 2, 3));
            System.Console.WriteLine(pair is (1, "s"));
            System.Console.WriteLine(a is [.., 1, ..]);
            System.Console.WriteLine(a is ["s"]);
            System.Console.WriteLine(5 is [1]);
        }
    }
  `,
    ),
    diag(
      'switch-expression-not-exhaustive',
      cs`
    enum Color { Red, Green, Blue }
    record Point(int X, int Y);
    class Program
    {
        static int A(int n) => n switch { 1 => 1, 2 => 2 };
        static int B(bool b) => b switch { true => 1 };
        static int C(Color c) => c switch { Color.Red => 1, Color.Green => 2 };
        static int D(Color c) => c switch { Color.Red => 1, Color.Green => 2, Color.Blue => 3 };
        static int E((bool, bool) t) => t switch { (true, _) => 1, (false, true) => 2 };
        static int F(int n) => n switch { > 0 => 1, < 0 => 2 };
        static int G(string s) => s switch { "a" => 1, "b" => 2 };
        static int H(int? n) => n switch { > 0 => 1, <= 0 => 2 };
        static int I(Point p) => p switch { (0, _) => 1, (_, 0) => 2 };
        static int J(int n) => n switch { > 0 when n > 5 => 1, <= 0 => 2 };
        static int K(Point p) => p switch { { X: 0 } => 1, { X: not 0, Y: > 0 } => 2 };
        static void Main() { }
    }
  `,
    ),
    out(
      'exhaustive-switch-expressions-have-no-warning',
      cs`
    using System;
    enum Color { Red, Green }
    record Point(int X, int Y);
    class Program
    {
        static int A(bool b) => b switch { true => 1, false => 2 };
        static int B((bool, bool) t) => t switch { (true, _) => 1, (false, true) => 2, (false, false) => 3 };
        static int C(int n) => n switch { > 0 => 1, 0 => 2, < 0 => 3 };
        static int D(Point p) => p switch { (0, _) => 1, (not 0, <= 5) => 2, (_, > 5) => 3 };
        static int E(string s) => s switch { "a" => 1, not "a" => 2 };
        static int F(Point p) => p switch { { X: > 0 } => 1, { X: <= 0 } => 2 };
        static int G(int n) => n switch { >= 0 and < 10 => 1, >= 10 or < 0 => 2 };
        static int H(object o) => o switch { null => 0, not null => 1 };
        static int I((int, Color) t) => t switch { (_, Color.Red) => 1, (> 3, _) => 2, var (n, c) => 3 };
        static void Main()
        {
            Console.WriteLine(A(true) + B((false, false)) + C(-5) + D(new Point(1, 9)) + E("z") + F(new Point(0, 0)) + G(12) + H("x") + I((9, Color.Green)));
        }
    }
  `,
    ),
    diag(
      'subsumed-arms-and-cases',
      cs`
    record Point(int X, int Y);
    class Program
    {
        static int A(int n) => n switch { > 0 => 1, 5 => 2, _ => 3 };
        static int B(bool b) => b switch { true => 1, false => 2, _ => 3 };
        static int C((int, int) t) => t switch { (0, _) => 1, (0, 1) => 2, _ => 3 };
        static int D(string s) => s switch { null => 0, not null => 1, "a" => 2 };
        static int E(Point p) => p switch { { X: > 0 } => 1, (5, 5) => 2, { X: 3, Y: 4 } => 3, _ => 4 };
        static int F(int n) => n switch { > 5 and < 3 => 1, _ => 2 };
        static int G(int n) => n switch { 1 when n > 0 => 1, 1 => 2, _ => 3 };
        static void S(int n, object o)
        {
            switch (n)
            {
                case > 0: break;
                case 7: break;
                case 0: break;
                case <= 0: break;
                case 0 when n == 0:
                default: break;
            }
            switch (o)
            {
                case null: break;
                case var x: break;
                case string s: break;
            }
        }
        static void Main() { }
    }
  `,
    ),
  ]),
];
