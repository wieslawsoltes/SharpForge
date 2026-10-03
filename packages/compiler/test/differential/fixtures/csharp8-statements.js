/**
 * Differential fixtures for SF-A02-T68: static local and anonymous functions (what they may reference and the
 * capture errors), using declarations (disposal order, the declaration rules, jumps over a declaration) and
 * pattern-based disposal of ref structs.
 */
import { cs, out, diag, feature } from './kit.js';

const resource = `class R : IDisposable
    {
        string name;
        public R(string name) { this.name = name; Console.WriteLine("open " + name); }
        public void Dispose() { Console.WriteLine("close " + name); }
    }`;

export const fixtures = [
  ...feature('static-functions', [
    out(
      'static-functions-use-constants-statics-and-each-other',
      cs`
    using System;
    class Program
    {
        const int K = 3;
        static int S = 4;
        static void Main()
        {
            int k = 2;
            const int c = 5;
            static int Twice(int x) => x * 2 + K + S + c;
            static int Fact(int n) => n <= 1 ? 1 : n * Fact(n - 1);
            static string Name() => nameof(k);
            int Add(int x) { static int Inner(int y) => y + 1; return Inner(x) + k; }
            Func<int, int> f = static x => x + 1;
            Console.WriteLine(Twice(4) + " " + Fact(4) + " " + Name() + " " + Add(1) + " " + f(1));
        }
    }
  `,
    ),
    diag(
      'static-local-function-captures',
      cs`
    using System;
    class Program
    {
        int f;
        static int sf;
        int P { get { return f; } }
        void I() { }
        void M(int p)
        {
            int l = 0;
            static int B2() => f;
            static int B3() { return this.f; }
            static int B4() => p + l;
            static void B5() { I(); }
            static int B6() => P + sf;
            static int B7() { int Inner() => l; return Inner(); }
            static string B8() => base.ToString();
            static Func<int> B9() => () => l;
            static int B10() { l = 3; l++; return 0; }
            static void B11() { void N() { p++; } N(); }
            B2(); B3(); B4(); B5(); B6(); B7(); B8(); B9(); B10(); B11();
        }
        static void Main() { sf = 1; new Program().M(sf); }
    }
  `,
    ),
    diag(
      'static-function-references-a-local-function',
      cs`
    using System;
    class Program
    {
        static void M<T>(int p, T t)
        {
            int l = 0;
            int NonCapturing() => 1;
            int Capturing() => l;
            static int S0() => 2;
            static int A1() { return NonCapturing(); }
            static int A2() { Func<int> g = NonCapturing; return g(); }
            static int A3() { Func<int> g = Capturing; return g() + S0(); }
            static T A4(T x) => x;
            static string A5() => nameof(l) + nameof(p);
            static int A6() => typeof(T).Name.Length;
            static void A7() { int q = 0; int N() => q; N(); Func<int> z = () => q; z(); }
            Func<int> s1 = static () => NonCapturing();
            Func<int> s2 = static () => { int q = 1; Func<int> z = () => q; return z(); };
            A1(); A2(); A3(); A4(t); A5(); A6(); A7(); s1(); s2();
        }
        static void Main() { M(1, 2); }
    }
  `,
    ),
    diag(
      'static-anonymous-function-captures',
      cs`
    using System;
    class Program
    {
        int f = 1;
        void M(int p)
        {
            int l = 0;
            Func<int> a = static () => l;
            Func<int> b = static () => p;
            Func<int> c = static () => f;
            Func<int> d = static () => this.f;
            Func<int> e = static delegate { return l; };
            Func<Func<int>> g = static () => () => l;
            Func<int> h = static () => { int L() => l; return L(); };
        }
        static void Main() { new Program().M(1); }
    }
  `,
    ),
  ]),
  ...feature('using-declarations', [
    out(
      'disposed-in-reverse-order-at-the-end-of-the-block',
      cs`
    using System;
    ${resource}
    class Program
    {
        static void Main()
        {
            using var a = new R("a");
            {
                using R b = new R("b"), c = new R("c");
                Console.WriteLine("inner");
            }
            using R d = null;
            Console.WriteLine("end");
        }
    }
  `,
    ),
    diag(
      'declaration-rules',
      cs`
    using System;
    class R : IDisposable { public void Dispose() { } }
    class N { }
    class Program
    {
        static void Main(string[] args)
        {
            using var a = new N();
            using var b = new R(), c = new R();
            using R d;
            using var g = new R();
            g = null;
            if (args.Length > 1) using var h = new R();
            M(ref g);
            M(out g);
            using (N n = new N()) { }
            using (R r) { }
        }
        static void M(ref R r) { }
        static void M(out R r, int x = 0) { r = null; }
    }
  `,
    ),
    diag(
      'goto-over-a-using-declaration',
      cs`
    using System;
    class R : IDisposable { public void Dispose() { } }
    class Program
    {
        static void Main(string[] args)
        {
            if (args.Length > 5) goto After;
            using var f = new R();
            After: Console.WriteLine();
            if (args.Length > 6) goto Inner;
            {
                using var g = new R();
                Inner: Console.WriteLine();
            }
        }
        static void Back(string[] args)
        {
            Before: Console.WriteLine();
            using var f = new R();
            if (args.Length > 5) goto Before;
            {
                if (args.Length > 6) goto Before;
            }
        }
        static void Allowed(string[] args)
        {
            Outer: Console.WriteLine();
            {
                using var f = new R();
                if (args.Length > 5) goto Outer;
            }
        }
    }
  `,
    ),
    out(
      'ref-struct-disposed-by-pattern',
      cs`
    using System;
    ref struct RS
    {
        int id;
        public RS(int id) { this.id = id; }
        public void Dispose() { Console.WriteLine("dispose " + id); }
    }
    class Program
    {
        static void Main()
        {
            using (var r = new RS(1)) { Console.WriteLine("body"); }
            using var q = new RS(2);
            using (new RS(3)) Console.WriteLine("expr");
            Console.WriteLine("end");
        }
    }
  `,
    ),
    diag(
      'pattern-disposal-needs-an-accessible-void-dispose-on-a-ref-struct',
      cs`
    class C { public void Dispose() { } }
    struct S { public void Dispose() { } }
    ref struct RS { void Dispose() { } }
    ref struct RP { public int Dispose() { return 0; } }
    ref struct RE { }
    static class X { public static void Dispose(this RE r) { } }
    class Program
    {
        static void Main()
        {
            using (var r = new C()) { }
            using var s = new S();
            using (var t = new RS()) { }
            using (var u = new RP()) { }
            using (var v = new RE()) { }
        }
    }
  `,
    ),
    diag(
      'pattern-disposal-in-7-3',
      cs`
    ref struct RS { public void Dispose() { } }
    class Program
    {
        static void Main()
        {
            using (var r = new RS()) { }
            using (new RS()) { }
        }
    }
  `,
      { langVersion: '7.3' },
    ),
  ]),
];
