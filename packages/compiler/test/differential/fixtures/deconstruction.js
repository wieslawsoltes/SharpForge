/**
 * Differential fixtures for SF-A02-T08.5 (deconstruction) and for the by-reference parameters `Deconstruct` methods
 * need (the lowering half of SF-A02-T04.2). The output programs run from the semantic code generator; the pinned
 * output is what the same program prints on .NET.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('by-reference', [
    out(
      'ref-out-in-parameters-share-the-variable',
      cs`
    using System;
    class Counter
    {
        public int Total;
        public Counter(out int initial) { initial = 7; Total = initial; }
        public bool TryTake(int amount, out int taken)
        {
            if (amount > Total) { taken = 0; return false; }
            Total -= amount; taken = amount; return true;
        }
    }
    class Program
    {
        static void Swap(ref int a, ref int b) { int t = a; a = b; b = t; }
        static void Twice(ref int value) { Bump(ref value); Bump(ref value); }
        static void Bump(ref int value) { value++; }
        static int Sum(in int a, in int b) { return a + b; }
        static void Alias(ref int a, ref int b) { a = 1; b = 2; Console.WriteLine(a); }
        static void Fail(out int value) { value = 5; throw new Exception("after"); }
        static void Split(string text, out string head, out int length) { head = text + "!"; length = text.Length; }
        static void Main()
        {
            int x = 1, y = 2;
            Swap(ref x, ref y);
            Console.WriteLine(x * 10 + y);
            Twice(ref x);
            Console.WriteLine(x);
            Console.WriteLine(Sum(x, y) + Sum(in x, 5));
            Alias(ref x, ref x);
            Console.WriteLine(x);
            var counter = new Counter(out int start);
            Console.WriteLine(start);
            if (counter.TryTake(3, out var taken)) Console.WriteLine(taken + " " + counter.Total);
            Console.WriteLine(counter.TryTake(30, out _));
            int kept = 0;
            try { Fail(out kept); } catch (Exception e) { Console.WriteLine(e.Message + kept); }
            Split("hello", out string head, out int length);
            Console.WriteLine(head + length);
        }
    }
  `,
    ),
    out(
      'by-reference-with-closures-loops-and-local-functions',
      cs`
    using System;
    class Program
    {
        static void Bump(ref int value) { value++; }
        static void Fill(out (int, string) pair, ref string text) { pair = (text.Length, text); text = text + text; }
        static void Main()
        {
            int x = 1;
            Func<int> read = () => x;
            Bump(ref x);
            Console.WriteLine(read());
            void Local(ref int v, out string s) { v += 100; s = "local"; }
            Local(ref x, out var text);
            Console.WriteLine(text + x);
            for (int i = 0; i < 4; i++) { Bump(ref i); Console.WriteLine(i); }
            Fill(out var pair, ref text);
            Console.WriteLine(pair + text);
        }
    }
  `,
    ),
  ]),
  ...feature('deconstruction', [
    out(
      'tuples-into-variables-and-swap',
      cs`
    using System;
    class Program
    {
        static (int sum, int count) Tally(int[] values)
        {
            int sum = 0;
            foreach (var value in values) sum += value;
            return (sum, values.Length);
        }
        static void Main()
        {
            var (s, c) = Tally(new[] { 1, 2, 3 });
            Console.WriteLine(s + c);
            int p; int q;
            (p, q) = (3, 4);
            (p, q) = (q, p);
            Console.WriteLine(p * 10 + q);
            (int a, string b) = (1, "one");
            Console.WriteLine(a + b);
            (var x, _, (var y, _)) = (1, 2, (3, 4));
            Console.WriteLine(x + y);
            double d;
            (d, _) = (1, "ignored");
            Console.WriteLine(d / 2);
            ((p, q), s) = ((10, 20), 30);
            Console.WriteLine(p + q + s);
            int m;
            (m, var fresh) = (1, 2);
            Console.WriteLine(m + fresh);
            var (left, (inner, text)) = (1, Tally(new[] { 5 }));
            Console.WriteLine(left + inner + text);
        }
    }
  `,
    ),
    out(
      'deconstruct-methods-instance-and-extension',
      cs`
    using System;
    class Pair
    {
        public int A; public string B;
        public Pair(int a, string b) { A = a; B = b; }
        public void Deconstruct(out int a, out string b) { Console.Write("D"); a = A; b = B; }
        public void Deconstruct(out int a, out string b, out int length) { a = A; b = B; length = B.Length; }
    }
    class Wide { public int W = 3; }
    static class WideExtensions
    {
        public static void Deconstruct(this Wide wide, out int w, out int twice, out (int, int) both) { w = wide.W; twice = w * 2; both = (w, twice); }
    }
    class Program
    {
        static void Main()
        {
            (int a, string b) = new Pair(1, "one");
            Console.WriteLine(a + b);
            var (n, word, length) = new Pair(2, "two");
            Console.WriteLine(n + word + length);
            var (w, twice, (lo, hi)) = new Wide();
            Console.WriteLine(w + twice + lo + hi);
            double widened; object boxed;
            (widened, _) = new Pair(4, "four");
            Console.WriteLine(widened / 8);
            (_, boxed) = new Pair(5, "five");
            Console.WriteLine(boxed);
        }
    }
  `,
    ),
    out(
      'targets-are-evaluated-before-the-value-and-stored-in-order',
      cs`
    using System;
    class Holder
    {
        public int F;
        public int[] Items = new int[3];
        int p;
        public int P { get { return p; } set { Console.WriteLine("set P " + value); p = value; } }
        public int this[int index] { get { return Items[index]; } set { Console.WriteLine("set [" + index + "] " + value); Items[index] = value; } }
    }
    class Program
    {
        static Holder Get(Holder h, string label) { Console.WriteLine("target " + label); return h; }
        static int Index(int i) { Console.WriteLine("index " + i); return i; }
        static int Value(int v) { Console.WriteLine("value " + v); return v; }
        static void Main()
        {
            var h = new Holder();
            (Get(h, "a").F, Get(h, "b").Items[Index(1)], Get(h, "c").P, Get(h, "d")[Index(2)]) = (Value(7), Value(8), Value(9), Value(10));
            Console.WriteLine(h.F + " " + h.Items[1] + " " + h.P + " " + h.Items[2]);
            (int n, string name) t = (5, "five");
            (t.n, t.name) = (t.n + 1, t.name + "!");
            Console.WriteLine(t);
        }
    }
  `,
    ),
    diag(
      'errors',
      cs`
    class C { public void Deconstruct(out int a, out int b) { a = 1; b = 2; } }
    class Program
    {
        static void Main()
        {
            var (a, b) = (1, 2, 3);
            var (c, d) = 5;
            var (e, f) = null;
            (int g, string h) = (1, 2);
            var (i, j, k) = new C();
            int x = 0;
            (x, 5) = (1, 2);
            var (m, n) = (1, null);
            (int o, string p) = new C();
            System.Console.WriteLine(x);
        }
    }
  `,
    ),
    diag(
      'definite-assignment-and-unused-variables',
      cs`
    class Program
    {
        static void Main()
        {
            int a, b, c;
            (a, b) = (1, 2);
            System.Console.WriteLine(a + b + c);
            var (used, unused) = (1, 2);
            System.Console.WriteLine(used);
        }
    }
  `,
    ),
    diag(
      'mixed-declarations-need-10',
      cs`
    class Program
    {
        static void Main()
        {
            int a;
            (a, var b) = (1, 2);
            System.Console.WriteLine(a + b);
        }
    }
  `,
      { langVersion: '9.0' },
    ),
  ]),
];
