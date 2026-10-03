/**
 * Differential fixtures for SF-A02-T63: `out` variables, discards and the scope of expression variables in
 * statements, member initializers, constructor initializers and queries.
 */
import { cs, out, diag, feature } from './kit.js';

const helpers = `static bool T(out int v) { v = 1; return true; }
        static bool T(int k, out int v) { v = k + 1; return true; }`;
const queryPattern = `class Seq
    {
        public Seq Where(Func<int, bool> predicate) { return this; }
        public Seq Select(Func<int, int> selector) { return this; }
    }`;

export const fixtures = [
  ...feature('expression-variables', [
    out(
      'out-variables-are-typed-by-the-chosen-overload',
      cs`
    using System;
    class Program
    {
        static bool TryGet(int k, out int v) { v = k * 2; return k > 0; }
        static void M(out int x) { x = 1; }
        static void M(out string x, int y) { x = "s"; }
        static void N(out string s) { s = "n"; }
        static void Main()
        {
            if (TryGet(3, out int a)) Console.WriteLine(a);
            if (TryGet(4, out var b)) Console.WriteLine(b);
            while (TryGet(a - 6, out var c)) { Console.WriteLine(c); a--; }
            Console.WriteLine(a + b);
            M(out int i); Console.WriteLine(i);
            M(out string s, 1); Console.WriteLine(s);
            M(out var q); Console.WriteLine(q + 1);
            N(out var t); Console.WriteLine(t.Length);
        }
    }
  `,
    ),
    out(
      'scopes-in-statements-and-initializers',
      cs`
    using System;
    class Program
    {
        ${helpers}
        static int F = T(out var q) ? q : 0;
        int G = T(out var g) ? g + 1 : 0;
        static int P => T(out var p) ? p : 0;
        Program() : this(T(out var c) ? c : 0) { Console.WriteLine("initializer variable " + c); }
        Program(int x) { Console.WriteLine("ctor " + x); }
        static void Main()
        {
            if (!T(out var a)) return;
            Console.WriteLine(a + F + P + new Program().G);
            for (int i = 0; T(out var z) && i < 1; i++) Console.WriteLine(z);
            Func<int, int> f = x => T(out var y) ? y + x : 0;
            Console.WriteLine(f(2));
            switch (T(out var s) ? s : 0) { case 1: Console.WriteLine("one" + s); break; }
            do { } while (T(out var w) && w > 1);
            var k = T(out var u) ? u : 0;
            Console.WriteLine(k + u);
        }
    }
  `,
    ),
    diag(
      'scope-of-conditions-and-embedded-statements',
      cs`
    using System;
    class Program
    {
        ${helpers}
        static void Main(string[] args)
        {
            while (T(out var w)) { w++; break; }
            Console.WriteLine(w);
            do { } while (T(out var d) && d > 5);
            Console.WriteLine(d);
            for (int i = T(out var f0) ? f0 : 0; T(out var f1) && i < 1; i += T(out var f2) ? f2 : 1) { Console.WriteLine(f0 + f1); }
            Console.WriteLine(f0); Console.WriteLine(f1); Console.WriteLine(f2);
            foreach (var x in new int[T(out var fe) ? fe : 0]) { Console.WriteLine(fe); }
            Console.WriteLine(fe);
            using (T(out var u) ? null : (IDisposable)null) { Console.WriteLine(u); }
            Console.WriteLine(u);
            lock (T(out var lk) ? args : args) { Console.WriteLine(lk); }
            Console.WriteLine(lk);
            switch (T(out var s) ? s : 0) { case 1: Console.WriteLine(s); break; }
            Console.WriteLine(s);
            if (T(out var c)) Console.WriteLine(c);
            Console.WriteLine(c);
            Console.WriteLine(T(out var e) ? e : 0);
            Console.WriteLine(e);
            if (args.Length > 0) T(out var a);
            Console.WriteLine(a);
            if (args.Length > 0) Console.WriteLine(T(out var b) ? b : 0); else Console.WriteLine(b);
            while (args.Length > 0) T(out var n);
            Console.WriteLine(n);
        }
    }
  `,
    ),
    diag(
      'use-before-declaration-and-conflicts',
      cs`
    using System;
    class Program
    {
        ${helpers}
        static void Main(string[] args)
        {
            Console.WriteLine(a);
            T(out var a);
            { Console.WriteLine(b); }
            T(out var b);
            int z = y; T(out var y);
            { int n = 1; } T(out var n);
            T(out var m); { int m = 1; }
            Func<int> g = () => p; T(out var p);
            if (T(out var dup)) { }
            int dup = 2;
            T(out var twice); T(out var twice);
            _ = T(out var same) && T(out var same);
        }
    }
  `,
    ),
    diag(
      'switch-sections-share-one-declaration-space',
      cs`
    using System;
    class Program
    {
        ${helpers}
        static void Main(string[] args)
        {
            switch (args.Length)
            {
                case 0: int e = 1; Console.WriteLine(e); break;
                case 1: e = 2; Console.WriteLine(e); break;
                case 2: var g = T(out var h) ? h : 0; Console.WriteLine(g + h); break;
                case 3: Console.WriteLine(h); int e = 3; break;
            }
        }
    }
  `,
    ),
    diag(
      'typed-out-variables-need-the-parameter-type',
      cs`
    using System;
    class Program
    {
        ${helpers}
        static void S(out string s) { s = ""; }
        static void A(out int x, out string y) { x = 1; y = ""; }
        static void A(out string x, out int y) { x = ""; y = 1; }
        static void G<U>(out U u) { u = default(U); }
        static void Main(string[] args)
        {
            T(out string s);
            T(out long l);
            S(out object o);
            S(out var ok); ok = 3;
            A(out var p, out var q);
            A(out int p2, out var q2); Console.WriteLine(q2.Length);
            G(out var g1);
            G<int>(out var g2); Console.WriteLine(g2 + 1);
            G(out int g3);
            T(out var dup, out var dup2);
            Missing(out var mm); Console.WriteLine(mm);
            var v = T(out v);
            T(1, out string _);
        }
    }
  `,
    ),
    diag(
      'definite-assignment-of-out-variables',
      cs`
    using System;
    class Program
    {
        ${helpers}
        static void Main(string[] args)
        {
            bool c = false && T(out var d); Console.WriteLine(d);
            bool c2 = args.Length > 0 && T(out var d2); Console.WriteLine(d2);
            bool c3 = args.Length > 0 || T(out var d3); Console.WriteLine(d3);
            if (args.Length > 0 && T(out var d4)) Console.WriteLine(d4); else Console.WriteLine(d4);
            var r = args.Length > 0 ? T(out var d5) : false; Console.WriteLine(d5);
            T(out var d6); Console.WriteLine(d6);
            T(out _); T(out var _); T(out int _);
            if (!T(out var d7)) return; Console.WriteLine(d7);
            Console.WriteLine(c || c2 || c3 || r);
        }
    }
  `,
    ),
    diag(
      'member-initializers-in-7-2',
      cs`
    using System;
    class Program
    {
        ${helpers}
        static int F = T(out var q) ? q : 0;
        int G = T(out var g) ? g + 1 : 0;
        static int P { get; } = T(out var p) ? p : 0;
        Program() : this(T(out var c) ? c : 0) { Console.WriteLine(c); }
        Program(int x) { Console.WriteLine("ctor " + x + G); }
        static void Main() { Console.WriteLine(F + P); new Program(); }
    }
  `,
      { langVersion: '7.2' },
    ),
    diag(
      'initializer-variables-are-scoped-to-their-initializer',
      cs`
    using System;
    class Program
    {
        ${helpers}
        static int F = T(out var q) ? q : 0;
        static int F2 = q;
        int G = T(out var g) ? g + 1 : g2;
        static void Main() { Console.WriteLine(q); }
        Program(int a) : this(T(out var c), c) { int c = 2; }
        Program(bool b, int x) { }
    }
  `,
    ),
    diag(
      'query-clauses-scope-their-variables',
      cs`
    using System;
    ${queryPattern}
    class Program
    {
        ${helpers}
        static void Main()
        {
            var a = new Seq();
            var q = from x in a where T(x, out var y) && y > 1 select x + y;
            var r = from x in a where T(x, out var y) select y;
            var s = from x in a select T(x, out var z) ? z : 0;
            Console.WriteLine(z);
        }
    }
  `,
    ),
    diag(
      'query-clauses-in-7-2',
      cs`
    using System;
    ${queryPattern}
    class Program
    {
        ${helpers}
        static void Main()
        {
            var a = new Seq();
            var q = from x in a where T(x, out var y) && y > 1 select x;
            var s = from x in a select T(x, out var z) ? z : 0;
            Func<int, bool> f = x => T(x, out var inLambda) && inLambda > 0;
        }
    }
  `,
      { langVersion: '7.2' },
    ),
  ]),
  ...feature('discards', [
    out(
      'discards-evaluate-and-drop',
      cs`
    using System;
    class Program
    {
        static int Count;
        static int Next() { return ++Count; }
        static void Two(out int a, out int b) { a = 1; b = 2; }
        static void Main()
        {
            _ = Next();
            Two(out _, out var z);
            Two(out var _, out int _);
            Func<int, int, int> f = (_, _) => 7;
            Console.WriteLine(Count + " " + z + " " + f(1, 2));
            var (_, y) = (Next(), Next());
            (_, _) = (Next(), Next());
            Console.WriteLine(Count + " " + y);
            WithLocal();
        }
        static void WithLocal()
        {
            int _ = 5;
            _ = 6;
            Two(out _, out _);
            Console.WriteLine(_);
        }
    }
  `,
    ),
    diag(
      'underscore-is-a-variable-when-one-is-in-scope',
      cs`
    using System;
    class Program
    {
        static void Two(out int a, out int b) { a = 1; b = 2; }
        static void Parameter(int _)
        {
            _ = "s";
            Console.WriteLine(_ + 1);
            Two(out _, out string _);
        }
        static void NoVariable()
        {
            Console.WriteLine(_);
            var x = _;
            _ = _;
            _++;
            Two(out _, out var _).ToString();
        }
        static void Main() { Parameter(1); NoVariable(); }
    }
  `,
    ),
    diag(
      'discards-in-6',
      cs`
    class Program
    {
        static void Two(out int a, out int b) { a = 1; b = 2; }
        static int Next() { return 1; }
        static void Main()
        {
            _ = Next();
            Two(out _, out _);
        }
    }
  `,
      { langVersion: '6' },
    ),
  ]),
];
