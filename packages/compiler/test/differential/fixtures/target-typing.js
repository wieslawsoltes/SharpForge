/**
 * Differential fixtures for SF-A02-T71 (C# 9 target typing): `new()`, the conditional operator without a natural
 * type and the switch expression without a best common type. Programs avoid class hierarchies, structs and nullable
 * value types, which the runtime profile cannot execute; the diagnostics fixtures use them freely.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('target-typing', [
    out(
      'conditional-converts-to-the-target-type',
      cs`
    using System;
    class Pt { public int X; public Pt() { } public Pt(int x) { X = x; } }
    class Program
    {
        static string Show(object o) => "F" + o;
        static Pt Same(Pt p) => p;
        static void Main(string[] args)
        {
            bool b = args.Length == 0;
            object o = b ? "s" : 1; Console.WriteLine(o);
            o = !b ? "s" : 1; Console.WriteLine(o);
            Console.WriteLine(Show(b ? 2 : "t"));
            Pt n = !b ? new Pt(1) : null; Console.WriteLine(n == null);
            Func<int, int> f = b ? x => x + 1 : x => x - 1; Console.WriteLine(f(1));
            Pt t = b ? new(4) : new Pt(5); Console.WriteLine(t.X);
            Console.WriteLine(Same(b ? new(6) : null).X);
            object c = (object)(b ? 1.5 : "u"); Console.WriteLine(c);
            object nested = !b ? "s" : b ? true : "t"; Console.WriteLine(nested);
        }
    }
  `,
    ),
    diag(
      'conditional-natural-type-wins',
      cs`
    class A { } class B : A { } class C : A { }
    class Program
    {
        static void G(int i) { }
        static void Main()
        {
            bool b = true;
            var v = b ? 1 : "s";
            var w = b ? new B() : new C();
            short s = b ? 1 : 2;
            var y = (short)(b ? 1 : 2);
            A a = (A)(b ? new B() : new C());
            string t = b ? 1 : "s";
            G(b ? 1 : "s");
            var z = b ? null : null;
            var q = b ? x => x : 1;
            (b ? 1 : "s").ToString();
        }
    }
  `,
    ),
    diag(
      'conditional-in-csharp-8',
      cs`
    class A { } class B : A { } class C : A { }
    class Program
    {
        static void F(A a) { }
        static void Main()
        {
            bool b = true;
            A a = b ? new B() : new C();
            object o = b ? "s" : 1;
            F(b ? new B() : new C());
            int? n = b ? 1 : null;
            a = b ? new B() : new C();
            a = (A)(b ? new B() : new C());
            var v = b ? 1 : "s";
        }
    }
  `,
      { langVersion: '8' },
    ),
    out(
      'switch-expression-converts-to-the-target-type',
      cs`
    using System;
    class Pt { public int X; public Pt(int x) { X = x; } }
    class Program
    {
        static string Show(object o) => "F" + o;
        static void Main()
        {
            int k = 2;
            object o = k switch { 1 => "s", _ => 1 }; Console.WriteLine(o);
            o = k switch { 1 => "s", 2 => 2.5, _ => true }; Console.WriteLine(o);
            Pt p = k switch { 2 => new(8), _ => null }; Console.WriteLine(p.X);
            Console.WriteLine(Show(k switch { 1 => "one", _ => 2 }));
            Func<int, int> f = k switch { 2 => x => x * 2, _ => x => x }; Console.WriteLine(f(4));
        }
    }
  `,
    ),
    diag(
      'switch-expression-without-a-type',
      cs`
    class A { } class B : A { } class C : A { }
    class Program
    {
        static void Main()
        {
            int k = 2;
            var v = k switch { 1 => new B(), _ => new C() };
            string s = k switch { 1 => "s", _ => 1 };
            var w = (A)(k switch { 1 => new B(), _ => new C() });
            A a = k switch { 1 => new B(), _ => new C() };
            (k switch { 1 => new B(), _ => new C() }).ToString();
        }
    }
  `,
    ),
    out(
      'new-takes-the-target-type',
      cs`
    using System;
    using System.Collections.Generic;
    class Pt { public int X; public Pt() { } public Pt(int x) { X = x; } }
    class Program
    {
        static Pt field = new(9);
        static Pt Make() => new(3);
        static int Use(Pt p) => p.X;
        static void Main()
        {
            Pt p = new(1); Console.WriteLine(p.X);
            Pt q = new() { X = 5 }; Console.WriteLine(q.X);
            Console.WriteLine(Make().X);
            Console.WriteLine(Use(new(7)));
            Console.WriteLine(field.X);
            List<int> l = new(); l.Add(1); Console.WriteLine(l.Count);
            Pt[] arr = { new(1), new(2) }; Console.WriteLine(arr[1].X);
            p = new(11); Console.WriteLine(p.X);
            Func<int> d = new(() => 12); Console.WriteLine(d());
            Pt cast = (Pt)new(13); Console.WriteLine(cast.X);
        }
    }
  `,
    ),
    diag(
      'new-target-type-rules',
      cs`
    class Pt { public Pt(int x) { } }
    interface I { } abstract class Ab { } enum E { A } delegate void D();
    class Program
    {
        static void M<T>() where T : new() { T t = new(); }
        static void N<T>() { T t = new(); }
        static void F() { }
        static void Main()
        {
            var v = new();
            Pt p = new();
            Pt q = new(1, 2);
            I x = new();
            Ab ab = new();
            object o = new();
            int[] a = new();
            D del = new();
            D ok = new(F);
            D bad = new(1);
            string s = new();
            new().ToString();
            Pt z = new() ?? p;
            Pt[] arr = { new(), new(1) };
            Pt c = true ? new() : new(2);
        }
    }
  `,
    ),
    diag(
      'delegate-creation-argument-count',
      cs`
    delegate void D();
    class Program
    {
        static void F() { }
        static void Main()
        {
            D a = new D();
            D b = new D(F, F);
            D c = new D(1);
            D d = new D(F);
        }
    }
  `,
    ),
    diag(
      'new-in-csharp-8',
      cs`
    class Pt { }
    class Program
    {
        static void Main() { Pt p = new(); }
    }
  `,
      { langVersion: '8' },
    ),
  ]),
];
