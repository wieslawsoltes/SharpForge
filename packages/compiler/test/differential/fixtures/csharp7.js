/**
 * Differential fixtures for SF-A02-T64 and SF-A02-T65: throw expressions, the `default` literal, `in` arguments
 * and overloads, non-trailing named arguments and the C# 7.3 generic constraints.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('throw-expressions', [
    out(
      'conditional-coalesce-and-expression-bodies',
      cs`
    using System;
    class Program
    {
        static string name;
        static string Name { get => name; set => name = value ?? throw new Exception("null value"); }
        static int Pick(bool b) => b ? 1 : throw new Exception("no");
        static int Pick2(bool b) => b ? throw new Exception("yes") : 2;
        static int Never() => throw new Exception("never");
        static void Act() => throw new Exception("act");
        static void Main()
        {
            Name = "x"; Console.WriteLine(Name);
            Console.WriteLine(Pick(true) + Pick2(false));
            try { Pick(false); } catch (Exception e) { Console.WriteLine(e.Message); }
            try { Pick2(true); } catch (Exception e) { Console.WriteLine(e.Message); }
            try { Name = null; } catch (Exception e) { Console.WriteLine(e.Message); }
            try { Never(); } catch (Exception e) { Console.WriteLine(e.Message); }
            try { Act(); } catch (Exception e) { Console.WriteLine(e.Message); }
            string s = null;
            try { var t = s ?? throw new Exception("coalesce"); Console.WriteLine(t); } catch (Exception e) { Console.WriteLine(e.Message); }
            Func<int> f = () => throw new Exception("lambda");
            try { f(); } catch (Exception e) { Console.WriteLine(e.Message); }
            Action g = () => throw new Exception("action");
            try { g(); } catch (Exception e) { Console.WriteLine(e.Message); }
            int n = 3; int m = n > 2 ? n : throw new Exception("unreached"); Console.WriteLine(m);
        }
    }
  `,
    ),
    diag(
      'contexts-and-operand-types',
      cs`
    using System;
    class Program
    {
        static void M(int x) { }
        static void Main(string[] args)
        {
            var a = throw new Exception();
            int b = (throw new Exception()) + 1;
            M(throw new Exception());
            int d = args.Length > 0 ? throw new Exception() : throw new Exception();
            object e = args ?? throw null;
            int f = args.Length > 0 ? 1 : throw new object();
            int g = args.Length > 0 ? 1 : throw "s";
        }
        static int Flow(string s) { int k; var u = s ?? throw new Exception(); k = 1; return k + u.Length; }
        static int Flow2(bool b) { int k; if (b) k = 1; else _ = b ? throw new Exception() : 0; return k; }
    }
  `,
    ),
    diag(
      'throw-expressions-in-6',
      cs`
    using System;
    class Program
    {
        static int Pick(bool b) => b ? 1 : throw new Exception("no");
        static void Main() { string s = null; var t = s ?? throw new Exception(); }
    }
  `,
      { langVersion: '6' },
    ),
    diag(
      'an-async-method-returns-a-task-like-type',
      cs`
    using System;
    using System.Threading.Tasks;
    class NotTaskLike<T> { }
    class Program
    {
        static async Task<int> A() { await Task.Delay(1); return 1; }
        static async ValueTask<int> V() { await Task.Delay(1); return 1; }
        static async NotTaskLike<int> B() { await Task.Delay(1); return 1; }
        static async int C() { await Task.Delay(1); return 1; }
        static async Task<string> D() { await Task.Delay(1); return 1; }
        static void Main() { }
    }
  `,
    ),
  ]),
  ...feature('default-literal', [
    out(
      'takes-the-type-it-is-converted-to',
      cs`
    using System;
    class Program
    {
        static int M(int x = default, string s = default, bool b = default) { return x + (s == null ? 1 : 0) + (b ? 10 : 0); }
        static int Zero() { return default; }
        static string Null() => default;
        static int Plus(int x) { return x + 1; }
        static void Main()
        {
            int i = default; string s = default; bool b = default; double d = default;
            Console.WriteLine(i + " " + (s == null) + " " + b + " " + d);
            Console.WriteLine(M() + " " + Zero() + " " + (Null() == default) + " " + (i == default) + " " + (s != default));
            int[] arr = { default, 2 };
            i = default; arr[1] = default;
            Console.WriteLine(arr[0] + arr[1] + (b ? default : 5) + M(default, default) + Plus(default));
            Program p = default; Console.WriteLine(p == null);
            const int k = default; const string ks = default; const bool kb = default; const double kd = default;
            Console.WriteLine(k + (ks == null ? "n" : "s") + kb + kd);
        }
    }
  `,
    ),
    diag(
      'needs-a-target-type',
      cs`
    using System;
    class Program
    {
        static void M(object o) { } static void M(string s) { }
        static void G<T>(T t) { }
        static void Main(string[] args)
        {
            var a = default;
            var b = default == default;
            default.ToString();
            G(default);
            int c = default + 1;
            int minus = -default;
            object o = default; if (o is default) { }
            var d = args.Length > 0 ? default : default;
            var e = new[] { default, default };
            foreach (var x in default) { }
            M(default);
            lock (default) { }
            int g = (default);
            var h = default as string;
            bool i2 = default is int;
            Console.WriteLine(c + minus + g);
        }
    }
  `,
    ),
    diag(
      'default-literal-in-7-0',
      cs`
    using System;
    class Program
    {
        static int M(int x = default) { return x; }
        static void Main() { int i = default; string s = default; Console.WriteLine(i + s + M()); }
    }
  `,
      { langVersion: '7' },
    ),
  ]),
  ...feature('in-arguments', [
    out(
      'a-by-value-parameter-is-better-than-in-without-a-modifier',
      cs`
    using System;
    class Program
    {
        static string M(int x) => "val";
        static string M(in int x) => "in";
        static string N(in int x) => "in" + x;
        static string O(in int x) => "in";
        static string O(string x) => "string";
        static void Main()
        {
            int a = 1;
            Console.WriteLine(M(a) + M(in a) + M(5) + N(a) + N(5) + N(in a) + O(a) + O(in a) + O("s"));
        }
    }
  `,
    ),
    diag(
      'in-arguments-are-readonly-variables',
      cs`
    using System;
    class Program
    {
        static void N(in int x) { x = 1; }
        static void R(ref int x) { }
        static void Q(in int x) { R(ref x); N(in x); N(x); }
        static void Main()
        {
            int a = 1; long l = 2;
            N(in 5);
            N(in l);
            N(out a);
            N(in a + 1);
            const int c = 3; N(in c);
            Q(a);
        }
    }
  `,
    ),
  ]),
  ...feature('named-arguments', [
    out(
      'named-arguments-in-position-may-be-followed-by-positional-ones',
      cs`
    using System;
    class Program
    {
        static int M(int a, int b, int c) { return a * 100 + b * 10 + c; }
        static int Opt(int a, int b = 2, int c = 3) { return a * 100 + b * 10 + c; }
        static int Par(int a, params int[] rest) { return a * 100 + rest.Length; }
        static void Main()
        {
            Console.WriteLine(M(a: 1, 2, 3));
            Console.WriteLine(M(1, b: 2, 3));
            Console.WriteLine(M(c: 3, a: 1, b: 2));
            Console.WriteLine(Opt(a: 1, 5));
            Console.WriteLine(Opt(1, b: 5, 7));
            Console.WriteLine(Par(a: 1, 2, 3));
        }
    }
  `,
    ),
    diag(
      'out-of-position-named-arguments',
      cs`
    class Program
    {
        static int M(int a, int b, int c) { return a * 100 + b * 10 + c; }
        int this[int a, int b] { get { return 0; } set { } }
        static void Main()
        {
            M(b: 1, 2, 3);
            M(c: 1, 2, a: 3);
            M(1, a: 2, 3);
            M(a: 1, a: 2, 3);
            M(1, 2, d: 3);
            M(a: 1, 2);
            var p = new Program(); p[b: 1, 2] = 3;
        }
    }
  `,
    ),
    diag(
      'non-trailing-named-arguments-in-7-1',
      cs`
    class Program
    {
        static int M(int a, int b, int c) { return a * 100 + b * 10 + c; }
        static void Main() { M(a: 1, 2, 3); M(1, b: 2, 3); M(1, 2, c: 3); M(c: 3, a: 1, b: 2); }
    }
  `,
      { langVersion: '7.1' },
    ),
  ]),
  ...feature('generic-constraints', [
    diag(
      'enum-delegate-and-unmanaged-constraints',
      cs`
    using System;
    enum Color { Red, Green }
    struct P2 { public int X, Y; }
    struct HasRef { public string S; }
    struct G<T> { public T V; }
    class C1<T> where T : unmanaged, IDisposable { }
    class C2<T> where T : struct, unmanaged { }
    class C3<T> where T : class, unmanaged { }
    class C4<T> where T : unmanaged, new() { }
    class C5<T> where T : IDisposable, unmanaged { }
    class C6<T> where T : Enum, Delegate { }
    class C7<T> where T : System.ValueType { }
    class C8<T> where T : Array { }
    class C9<T, U> where T : unmanaged where U : T { }
    class C10<T, U> where T : struct where U : T { }
    class Program
    {
        static string E<T>(T v) where T : Enum { return v.ToString(); }
        static int U<T>(T v) where T : unmanaged { return 1; }
        static object D<T>(T d) where T : Delegate { return d; }
        static object MD<T>(T d) where T : MulticastDelegate { return d; }
        static T SE<T>(T v) where T : struct, Enum { return v; }
        static void Main()
        {
            E(Color.Green); U(3); U(1.5); U(Color.Red); U(new P2()); U(new G<int>()); D<Action>(Main); MD<Action>(Main); SE(Color.Red);
            E(3); U("s"); U(new HasRef()); U(new G<string>()); D(4); E<Enum>(Color.Red); SE<Enum>(Color.Red); U<int?>(null); U(new object());
        }
    }
  `,
    ),
    diag(
      'constraints-in-7-2',
      cs`
    using System;
    class Program
    {
        static string E<T>(T v) where T : Enum { return v.ToString(); }
        static int U<T>(T v) where T : unmanaged { return 1; }
        static object D<T>(T d) where T : Delegate { return d; }
        static object MD<T>(T d) where T : System.MulticastDelegate { return d; }
        static void Main() { }
    }
  `,
      { langVersion: '7.2' },
    ),
    diag(
      'unmanaged-constructed-types-in-7-3',
      cs`
    struct G<T> { public T V; }
    struct P2 { public int X; }
    class Program
    {
        static int U<T>(T v) where T : unmanaged { return 1; }
        static void Main() { U(new G<int>()); U(new P2()); U(3); }
    }
  `,
      { langVersion: '7.3' },
    ),
  ]),
];
