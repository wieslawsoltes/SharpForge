/**
 * Differential fixtures for C# 8 nullable reference types (SF-A02-E08): flow state through dereferences, null
 * tests, `??` and `??=`, arguments and assignments; `#nullable` contexts; members a constructor leaves null; and
 * signature agreement of overrides and implementations. Every fixture is pinned with Roslyn's warnings.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('nullable-references', [
    diag(
      'flow-state-through-tests-and-operators',
      cs`
    #nullable enable
    using System;
    class C
    {
        public string Name = "";
        public string? Maybe;
        public C? Next;
        public string Text() { return Name; }
    }
    class Program
    {
        static string? Find(int k) { return k > 0 ? "x" : null; }
        static void Main(string[] args)
        {
            string? a = Find(args.Length);
            Console.WriteLine(a.Length);
            if (a != null) Console.WriteLine(a.Length);
            string? b = Find(1);
            if (b == null) return;
            Console.WriteLine(b.Length);
            string? c = Find(2);
            Console.WriteLine(c!.Length);
            C? o = args.Length > 0 ? new C() : null;
            Console.WriteLine(o.Name);
            Console.WriteLine(o.Next.Name);
            o = new C();
            Console.WriteLine(o.Next.Name + o.Maybe.Length + o.Text().Length);
            var d = Find(3) ?? "d"; Console.WriteLine(d.Length);
            string? e = Find(4); e ??= "e"; Console.WriteLine(e.Length);
            string? f = Find(5); if (f is null) { f = "f"; } Console.WriteLine(f.Length);
            string? g = Find(6); if (g is string) Console.WriteLine(g.Length); else Console.WriteLine(g.Length);
            string? h = Find(7); if (string.IsNullOrEmpty(h)) return; Console.WriteLine(h.Length);
            string? i = Find(8); while (i == null) { i = Find(9); } Console.WriteLine(i.Length);
            string? j = Find(8); Console.WriteLine(j is { Length: 1 } ? j.Length : j.Length);
            string? k = Find(9); string l = k ?? throw new Exception(); Console.WriteLine(k.Length + l.Length);
            string? m = Find(9); string n = m ?? "n"; Console.WriteLine(m.Length + n.Length);
            string? p = Find(9); p ??= Find(1); Console.WriteLine(p.Length);
        }
    }
  `,
    ),
    diag(
      'assignments-arguments-and-elements',
      cs`
    #nullable enable
    using System;
    class C
    {
        public string Name;
        public string? Maybe;
        public string Prop { get; set; }
        public string Init { get; set; } = "";
        public C() { }
        public C(string name) { Name = name; Prop = name; }
        public C(int x) { }
    }
    class Program
    {
        static string M(string s) { return s; }
        static string? N(string? s) { return s; }
        static string R(string? s) { return s; }
        static void Main(string[] args)
        {
            string a = null;
            string? b = null;
            string c = b;
            M(null); M(b); N(null);
            string d = N("x");
            string[] arr = new string[] { null, "x" };
            string?[] arr2 = { null };
            arr[0] = null; arr2[0] = null; arr[1] = N("y");
            Console.WriteLine(arr2[0].Length + arr[0].Length);
            var c1 = new C(); c1.Name = null; c1.Maybe = null; c1.Prop = b;
            object o = b; object? o2 = b;
            string f = o2 as string;
            string g = default; string h = default(string);
            string k = b ?? null;
            string m = args.Length > 0 ? b : "x";
            Console.WriteLine(a + c + d + f + g + h + k + m + o);
            throw null;
        }
    }
  `,
    ),
    diag(
      'members-without-a-constructor',
      cs`
    #nullable enable
    class NoConstructor
    {
        public string Field;
        public string Property { get; set; }
        public string? Optional;
        public string Initialized = "";
        public string WithInitializer { get; set; } = "";
        public int Number;
        static string Shared;
        static string SharedProperty { get; set; }
        public static string Read() { return Shared + SharedProperty; }
    }
    class WithStaticConstructor
    {
        static string Shared;
        static WithStaticConstructor() { Shared = ""; }
        public static string Read() { return Shared; }
    }
    struct Value { public string Field; }
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'annotation-and-warning-contexts',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            string? a = null;
    #nullable enable
            string? b = null;
            string c = null;
            Console.WriteLine(b.Length);
    #nullable disable
            string d = null;
            Console.WriteLine(d.Length);
            string? e = null;
    #nullable enable warnings
            string f = null;
            string? g = null;
            Console.WriteLine(g.Length);
    #nullable enable annotations
    #nullable disable warnings
            string? h = null;
            Console.WriteLine(h.Length);
    #nullable restore
            string? i = null;
            Console.WriteLine(a + c + e + f + i);
        }
    }
  `,
    ),
    diag(
      'overrides-and-implementations-agree-on-nullability',
      cs`
    #nullable enable
    interface I { string M(string? s); string N(string s); }
    class A : I { public string? M(string s) { return s; } public string N(string? s) { return ""; } }
    class Base
    {
        public virtual string V(string? s) { return ""; }
        public virtual string? W(string s) { return s; }
        public virtual string X(string? s, string? t) { return ""; }
    }
    class D : Base
    {
        public override string? V(string s) { return s; }
        public override string W(string? s) { return ""; }
        public override string X(string s, string t) { return s + t; }
    }
    class Program { static void Main() { } }
  `,
    ),
    diag('nullable-annotation-in-7-3', cs`class Program { static void Main() { string? s = null; } }`, { langVersion: '7.3' }),
    out(
      'annotations-do-not-change-what-runs',
      cs`
    #nullable enable
    using System;
    class Program
    {
        static string? Find(int k) { return k > 0 ? "found" : null; }
        static void Main()
        {
            string? a = Find(1);
            string b = a ?? "none";
            string? c = Find(0);
            c ??= "filled";
            Console.WriteLine(b + " " + c + " " + (Find(0) == null) + " " + a!.Length);
        }
    }
  `,
    ),
  ]),
];
