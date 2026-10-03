/**
 * Differential fixtures for SF-A02-T67: indices and ranges on arrays, strings and types with implicit Index/Range
 * support, their evaluation order, the exceptions of ranges that do not fit, and the binding errors.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('index-range', [
    out(
      'array-elements-from-the-end-and-slices',
      cs`
    using System;
    class Program
    {
        static int Calls;
        static int[] Get(int[] a) { Calls++; return a; }
        static int One() { Calls += 10; return 1; }
        static void Main()
        {
            int[] a = { 1, 2, 3, 4, 5 };
            Console.WriteLine(a[^1] + " " + a[^2] + " " + a[^5]);
            int[] b = a[1..3]; int[] c = a[..2]; int[] d = a[3..]; int[] e = a[..]; int[] f = a[1..^1]; int[] g = a[^2..]; int[] h = a[^3..^1];
            Console.WriteLine(b.Length + " " + b[0] + b[1] + " " + c[1] + " " + d[0] + " " + e.Length + " " + f[2] + " " + g[0] + " " + h[1]);
            a[^1] = 50; a[^2] += 5; a[^3]++;
            Console.WriteLine(a[4] + " " + a[3] + " " + a[2]);
            Console.WriteLine(Get(a)[^One()] + " " + Calls);
            Console.WriteLine(Get(a)[One()..^One()].Length + " " + Calls);
            int n = 2;
            Console.WriteLine(a[^n] + " " + a[n..].Length + " " + a[..^n].Length + " " + a[0..0].Length);
            string[] s = { "x", "y", "z" };
            Console.WriteLine(s[^1] + s[1..][0]);
            e[0] = 99;
            Console.WriteLine(a[0]);
            double[] r = { 1.5, 2.5 };
            Program[] p = { new Program(), null };
            Console.WriteLine(r[^1] + r[1..][0] + " " + p[..1].Length);
        }
    }
  `,
    ),
    out(
      'string-ranges-are-substrings',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            string s = "hello";
            Console.WriteLine(s[1..3] + " " + s[..^2] + " " + s[2..] + " " + s[..] + " " + s[^3..^1] + "|" + s[2..2] + "|");
            int n = 1;
            Console.WriteLine(s[n..^n] + "abc"[1..]);
        }
    }
  `,
    ),
    out(
      'string-elements-from-the-end',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            string s = "hello";
            Console.WriteLine(s[^1] + " " + s[^5]);
        }
    }
  `,
    ),
    out(
      'implicit-support-through-length-count-indexer-and-slice',
      cs`
    using System;
    class L
    {
        int[] d = { 1, 2, 3, 4 };
        public int Length { get { Console.Write("[Length]"); return d.Length; } }
        public int this[int i] { get { Console.Write("[get]"); return d[i]; } set { Console.Write("[set]"); d[i] = value; } }
        public string Slice(int start, int length) { return start + ":" + length; }
    }
    class C
    {
        public int Count { get { return 3; } }
        public int this[int i] { get { return i * 10; } }
        public string Slice(int start, int length) { return start + ":" + length; }
    }
    class Program
    {
        static L Get(L l) { Console.Write("[receiver]"); return l; }
        static int One() { Console.Write("[one]"); return 1; }
        static void Main()
        {
            var l = new L();
            Console.WriteLine(l[^1] + " " + l[1..3] + " " + l[..^1] + " " + l[2..]);
            Get(l)[^One()] += 5; Console.WriteLine();
            Get(l)[^One()]++; Console.WriteLine();
            ++Get(l)[^One()]; Console.WriteLine();
            Get(l)[^One()] = One(); Console.WriteLine();
            int x = Get(l)[^One()]; Console.WriteLine(x);
            var c = new C();
            Console.WriteLine(c[^1] + " " + c[1..] + " " + c[..^1]);
        }
    }
  `,
    ),
    out(
      'ranges-that-do-not-fit-throw',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            int[] a = { 1, 2, 3 };
            try { Console.WriteLine(a[^4]); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            try { Console.WriteLine(a[2..1].Length); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            try { Console.WriteLine(a[..4].Length); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            try { Console.WriteLine("abc"[2..1]); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            try { Console.WriteLine(a[^0]); } catch (Exception e) { Console.WriteLine(e.GetType().Name); }
            Console.WriteLine(a[3..].Length + " " + a[^0..].Length);
        }
    }
  `,
    ),
    out(
      'index-and-range-values',
      cs`
    using System;
    class WithIndex
    {
        public int Length { get { return 4; } }
        public string this[Index i] { get { return "index " + i.Value; } }
        public string this[Range r] { get { return "range " + r.Start.Value; } }
        public int this[int i] { get { return i; } }
    }
    class Program
    {
        static Index Last() { return ^1; }
        static void Main()
        {
            int[] a = { 1, 2, 3, 4, 5 };
            Index i = ^2; Range r = 1..4; Index j = 1; Index k = 3;
            Console.WriteLine(a[i] + " " + a[r].Length + " " + a[j] + " " + i.Value + " " + i.IsFromEnd + " " + r.Start.Value);
            Range all = ..; Range tail = ^2..; Range head = ..3; Range mid = j..k; Range mid2 = j..^1;
            Console.WriteLine(a[all].Length + " " + a[tail].Length + " " + a[head].Length + " " + a[mid].Length + " " + a[mid2].Length);
            Console.WriteLine(i.GetOffset(5) + " " + j.Equals(k) + " " + Index.FromEnd(1).Value + " " + Index.Start.Value + " " + Range.All.End.IsFromEnd);
            var v = ^1; var w = 2..;
            Console.WriteLine(v.Value + " " + w.Start.Value);
            var ix = new WithIndex();
            Console.WriteLine(ix[^1] + " " + ix[1..2] + " " + ix[3]);
            Console.WriteLine(a[Last()] + " " + new Index(2, true).Value + " " + new Range(1, 2).End.Value);
        }
    }
  `,
    ),
    diag(
      'types-without-implicit-support-and-wrong-operands',
      cs`
    using System;
    class N { public int this[int i] { get { return i; } } }
    class OnlyLength { public int Length { get { return 1; } } public int this[int i] { get { return i; } } }
    class PrivateLength { int Length { get { return 1; } } public int this[int i] { get { return i; } } }
    class Program
    {
        static void Main()
        {
            int[] a = { 1, 2, 3 };
            var n = new N(); var o = new OnlyLength(); var p = new PrivateLength();
            Console.WriteLine(n[^1]);
            Console.WriteLine(n[1..]);
            Console.WriteLine(o[1..]);
            Console.WriteLine(p[^1]);
            Console.WriteLine(a[^"x"]);
            Console.WriteLine(a["x"..]);
            int[,] m = new int[2, 2]; Console.WriteLine(m[^1, 0]);
            a[1..2] = null;
            Index i = ^1L;
            Range r = 1..2..3;
            int x = ^1;
            int y = a[1..2];
            string s = "abc"; s[^1] = 'x';
            var z = ^^1;
        }
    }
  `,
    ),
    diag(
      'index-and-range-in-7-3',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            int[] a = { 1, 2, 3 };
            Console.WriteLine(a[^1]);
            Console.WriteLine(a[1..].Length);
            var r = ..;
        }
    }
  `,
      { langVersion: '7.3' },
    ),
  ]),
];
