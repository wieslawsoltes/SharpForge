/**
 * Differential fixtures for SF-A02-T66: `stackalloc` as a `Span<T>`, its initializers, its shape rules and the
 * language-version gates of the initializer (7.3) and of a nested stackalloc (8).
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('stackalloc', [
    out(
      'spans-over-stack-memory',
      cs`
    using System;
    class Program
    {
        static int Sum(ReadOnlySpan<int> values) { int sum = 0; foreach (var v in values) sum += v; return sum; }
        static void Main()
        {
            Span<int> s = stackalloc int[3];
            s[0] = 1; s[1] = 2; s[2] = s[0] + s[1];
            Span<int> t = stackalloc[] { 4, 5, 6 };
            Span<byte> u = stackalloc byte[2] { 7, 8 };
            ReadOnlySpan<int> r = stackalloc int[] { 9 };
            Console.WriteLine(s[2] + " " + t.Length + " " + t[1] + " " + u[1] + " " + r[0]);
            int sum = 0; foreach (var x in t) sum += x; Console.WriteLine(sum + " " + Sum(t) + " " + Sum(stackalloc int[] { 1, 2 }));
            Console.WriteLine(s.Slice(1).Length + " " + s[1..].Length + " " + s[^1]);
        }
    }
  `,
    ),
    diag(
      'shape-and-conversion-rules',
      cs`
    using System;
    class Program
    {
        static void M(Span<int> s) { }
        static void Main()
        {
            Span<int> a = stackalloc int[2] { 1, 2, 3 };
            Span<int> b = stackalloc int[];
            Span<long> c = stackalloc int[2];
            Span<int> d = stackalloc[] { 1, "s" };
            Span<string> e = stackalloc string[2];
            int[] f = stackalloc int[2];
            var g = stackalloc int[2];
            Span<int> h = stackalloc int[-1];
            Span<int> i = stackalloc int["x"];
            object o = stackalloc int[1];
            M(stackalloc int[1]);
            Span<int> j = true ? stackalloc int[1] : stackalloc int[2];
        }
        static Span<int> R() { Span<int> s = stackalloc int[1]; return s; }
    }
  `,
    ),
    diag(
      'stackalloc-initializers-in-7-2',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            Span<int> t = stackalloc[] { 4, 5, 6 };
            Span<int> u = stackalloc int[2] { 7, 8 };
            Span<int> v = stackalloc int[2];
        }
    }
  `,
      { langVersion: '7.2' },
    ),
    diag(
      'nested-stackalloc-in-7-3',
      cs`
    using System;
    class Program
    {
        static void M(Span<int> s) { }
        static void Main()
        {
            M(stackalloc int[1]);
            Span<int> j = true ? stackalloc int[1] : stackalloc int[2];
            Span<int> k = (stackalloc int[1]);
            int n = (stackalloc int[3]).Length;
        }
    }
  `,
      { langVersion: '7.3' },
    ),
  ]),
];
