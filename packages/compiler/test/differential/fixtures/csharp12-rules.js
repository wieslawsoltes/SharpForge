/**
 * Differential fixtures for SF-A02-T79 and SF-A02-T80 (C# 12): collection expressions for arrays, collection types
 * and spreads, inline array rules and aliases of any type. Each program declares an interface so that it is bound by
 * the semantic analysis (the execution pipeline has its own, smaller collection expression support).
 * `[Experimental]` diagnostics carry a user-chosen ID, which the pinned format cannot hold: they are in
 * tests/compiler-csharp12-rules.test.js.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('collection-expressions', [
    out(
      'arrays',
      cs`
    using System;
    interface IMarker { }
    class Program
    {
        static int Sum(int[] v) { int s = 0; foreach (var x in v) s += x; return s; }
        static string[] Names() => ["a", "b"];
        static void Main()
        {
            int[] a = [1, 2, 3]; Console.WriteLine(a.Length);
            string[] none = []; Console.WriteLine(none.Length);
            int[][] j = [[1], [2, 3]]; Console.WriteLine(j[1].Length);
            Console.WriteLine(Sum([4, 5]));
            Console.WriteLine(Names()[1]);
            a = [7]; Console.WriteLine(a[0]);
            object[] o = [1, "s", null]; Console.WriteLine(o.Length);
            double[] d = [1, 2.5]; Console.WriteLine(d[0] + d[1]);
        }
    }
  `,
    ),
    out(
      'collection-types',
      cs`
    using System;
    using System.Collections.Generic;
    interface IMarker { }
    class Bag : System.Collections.IEnumerable
    {
        public int Total;
        public void Add(int v) { Total += v; }
        public System.Collections.IEnumerator GetEnumerator() => null;
    }
    class Program
    {
        static int Count(List<string> l) => l.Count;
        static void Main()
        {
            List<int> l = [1, 2, 3]; Console.WriteLine(l.Count);
            HashSet<int> h = [1, 1, 2]; Console.WriteLine(h.Count);
            Console.WriteLine(Count(["x"]));
            List<List<int>> n = [[1], []]; Console.WriteLine(n[0].Count + n.Count);
            Bag b = [5, 6]; Console.WriteLine(b.Total);
            List<string> e = []; Console.WriteLine(e.Count);
        }
    }
  `,
    ),
    out(
      'spreads',
      cs`
    using System;
    using System.Collections.Generic;
    interface IMarker { }
    class Program
    {
        static void Main()
        {
            int[] a = [1, 2];
            List<int> l = [..a, 3];
            int[] b = [0, ..l, ..a];
            Console.WriteLine(l.Count + b.Length);
            int[] c = [..a, ..b]; Console.WriteLine(c[5]);
            List<int> m = [..l, ..l]; Console.WriteLine(m.Count);
        }
    }
  `,
    ),
    diag(
      'target-and-element-errors',
      cs`
    using System.Collections.Generic;
    class NoAdd : System.Collections.IEnumerable { public System.Collections.IEnumerator GetEnumerator() => null; }
    class NoConstructor : System.Collections.IEnumerable
    {
        public NoConstructor(int x) { }
        public void Add(int v) { }
        public System.Collections.IEnumerator GetEnumerator() => null;
    }
    class Program
    {
        static void F(int[] a) { }
        static void F(string s) { }
        static void Main()
        {
            var x = [1, 2];
            int y = [1];
            object o = [1];
            List<int> l = [1, "s"];
            int[,] m = [1];
            NoAdd na = [1];
            NoConstructor nc = [1];
            int[] sp = [..5];
            int[] chars = [.."ab"];
            F([1]);
            IEnumerable<string> e = [1];
            System.Collections.IEnumerable ne = [1];
            ([1]).ToString();
        }
    }
  `,
    ),
    diag(
      'collection-expressions-in-csharp-11',
      cs`
    class Program { static void Main() { int[] a = [1, 2, 3]; } }
  `,
      { langVersion: '11' },
    ),
  ]),
  ...feature('inline-arrays', [
    diag(
      'cs9167-cs9169-length-and-fields',
      cs`
    using System.Runtime.CompilerServices;
    [InlineArray(4)] struct Buffer { int element; }
    [InlineArray(0)] struct Empty { int element; }
    [InlineArray(-1)] struct Negative { int element; }
    [InlineArray(2)] struct TwoFields { int a; int b; }
    [InlineArray(2)] struct NoFields { static int shared = 1; static int Get() => shared; }
    class Program { static void Main() { } }
  `,
    ),
  ]),
  ...feature('alias-any-type', [
    out(
      'tuples-and-arrays',
      cs`
    using System;
    using Pt = (int X, int Y);
    using Arr = int[];
    class Program
    {
        static void Main() { Pt p = (1, 2); Arr a = new int[2]; Console.WriteLine(p.X + p.Y + a.Length); }
    }
  `,
    ),
    diag(
      'alias-any-type-in-csharp-11',
      cs`
    using Pt = (int X, int Y);
    using Arr = int[];
    class Program { static void Main() { } }
  `,
      { langVersion: '11' },
    ),
  ]),
];
