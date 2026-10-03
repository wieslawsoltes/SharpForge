/**
 * Differential fixtures for C# 13 params collections and OverloadResolutionPriorityAttribute (SF-A02-T81):
 * expanded calls into List<T>, HashSet<T>, constructors, indexers and delegates; better collection type and
 * element conversion between overloads; priorities within one declaring type; CS9202 below C# 13, CS0225, CS1729,
 * CS0117, CS9228, CS0231, CS1751, CS0121, CS1503, CS9261, CS9262.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('params-collections', [
    out(
      'lists-sets-constructors-indexers-delegates',
      cs`
        using System;
        using System.Collections.Generic;
        delegate int Counter(params List<int> xs);
        class Box
        {
            public int N;
            public Box(params List<string> names) { N = names.Count; }
            public int this[params List<int> keys] { get { return keys.Count; } }
        }
        class Program
        {
            static int Next() { Console.WriteLine("next"); return 5; }
            static int Len(params List<string> xs) { return xs.Count; }
            static string Join(string sep, params List<int> xs) { string r = ""; foreach (var x in xs) r += x + sep; return r; }
            static int First(params List<int> xs) { return xs.Count == 0 ? -1 : xs[0]; }
            static int Distinct(params HashSet<int> xs) { return xs.Count; }
            static int Count<T>(params List<T> xs) { return xs.Count; }
            static string Over(int a, params List<int> xs) { return "params"; }
            static string Over(int a, int b) { return "exact"; }
            static void Main()
            {
                Console.WriteLine(Len("a", "b"));
                Console.WriteLine(Len());
                Console.WriteLine(Len(new List<string> { "z" }));
                Console.WriteLine(Join("-", 1, Next(), 3));
                Console.WriteLine(First(xs: new List<int> { 9 }));
                Console.WriteLine(First(7));
                Console.WriteLine(Over(1, 2) + Over(1) + Over(1, 2, 3));
                Console.WriteLine(Distinct(1, 1, 2));
                Console.WriteLine(Count("a", "b", "c") + Count<int>());
                Console.WriteLine(new Box("a", "b", "c").N + new Box().N);
                Counter c = xs => xs.Count; Console.WriteLine(c(1, 2));
                Console.WriteLine(new Box()[1, 2, 3]);
            }
        }
      `,
    ),
    out(
      'better-collection-and-element-type',
      cs`
        using System;
        using System.Collections.Generic;
        class Program
        {
            static string P(params IEnumerable<int> xs) { return "enumerable"; }
            static string P(params List<int> xs) { return "list"; }
            static string Q(params IEnumerable<int> xs) { return "enumerable"; }
            static string Q(params int[] xs) { return "array"; }
            static string S(params List<double> xs) { return "double"; }
            static string S(params List<int> xs) { return "int"; }
            static void Main()
            {
                Console.WriteLine(P(1, 2));
                Console.WriteLine(Q(1, 2));
                Console.WriteLine(S(1, 2));
                Console.WriteLine(S(1.5, 2));
            }
        }
      `,
    ),
    diag(
      'cs9202-below-csharp-13',
      cs`
        using System.Collections.Generic;
        class Program
        {
            static int Len(params List<string> xs) { return xs.Count; }
            static int E(params IEnumerable<int> xs) { return 0; }
            static int A(params int[] xs) { return 0; }
            static void Main() { }
        }
      `,
      { langVersion: '12' },
    ),
    diag(
      'cs0225-cs1729-cs0117-cs9228-parameter-types',
      cs`
        using System;
        using System.Collections.Generic;
        class NoAdd : System.Collections.IEnumerable { public System.Collections.IEnumerator GetEnumerator() { return null; } }
        class NoCtor : List<int> { public NoCtor(int x) { } }
        class Program
        {
            static void A(params int x) { }
            static void B(params string s) { }
            static void C(params object o) { }
            static void D(params NoAdd n) { }
            static void E(params NoCtor n) { }
            static void G(params List<int> ok, int after) { }
            static void H(params List<int> ok = null) { }
            static void I(params IEnumerable<int> e) { }
            static void J(params System.Collections.IEnumerable e) { }
            static void Main() { }
        }
      `,
    ),
    diag(
      'cs0121-list-against-array-and-interfaces',
      cs`
        using System;
        using System.Collections.Generic;
        class Program
        {
            static string R(params IList<int> xs) { return "ilist"; }
            static string R(params IReadOnlyList<int> xs) { return "rolist"; }
            static string Pick(params List<int> xs) { return "list"; }
            static string Pick(params int[] xs) { return "array"; }
            static void Main()
            {
                Console.WriteLine(R(1, 2));
                Console.WriteLine(Pick(1));
            }
        }
      `,
    ),
    diag(
      'cs1503-element-conversions',
      cs`
        using System;
        using System.Collections.Generic;
        class Program
        {
            static int Len(params List<string> xs) { return xs.Count; }
            static void Main()
            {
                Len(1);
                Len(new List<int>());
            }
        }
      `,
    ),
  ]),
  ...feature('overload-resolution-priority', [
    out(
      'priority-within-a-declaring-type',
      cs`
        using System;
        using System.Runtime.CompilerServices;
        class C
        {
            [OverloadResolutionPriority(1)] public static string M(object o) { return "object"; }
            public static string M(string s) { return "string"; }
            [OverloadResolutionPriority(-1)] public static string N(int i) { return "int"; }
            public static string N(double d) { return "double"; }
            [OverloadResolutionPriority(2)] public C(object o) { Console.WriteLine("ctor object"); }
            public C(string s) { Console.WriteLine("ctor string"); }
            [OverloadResolutionPriority(1)] public int this[object o] { get { return 1; } }
            public int this[string s] { get { return 2; } }
            public static string K(int a) { return "exact"; }
            [OverloadResolutionPriority(5)] public static string K(string s) { return "string"; }
        }
        static class E
        {
            [OverloadResolutionPriority(1)] public static string X(this C c, object o) { return "ext object"; }
            public static string X(this C c, string s) { return "ext string"; }
        }
        static class F
        {
            public static string Y(this C c, string s) { return "F string"; }
        }
        static class G
        {
            [OverloadResolutionPriority(1)] public static string Y(this C c, object o) { return "G object"; }
        }
        class Program
        {
            static void Main()
            {
                Console.WriteLine(C.M("x"));
                Console.WriteLine(C.N(1));
                var c = new C("s");
                Console.WriteLine(c["k"]);
                Console.WriteLine(C.K(1));
                Console.WriteLine(c.X("s"));
                Console.WriteLine(c.Y("s"));
            }
        }
      `,
    ),
    diag(
      'cs9202-below-csharp-13',
      cs`
        using System;
        using System.Runtime.CompilerServices;
        class C
        {
            [OverloadResolutionPriority(1)] public static string M(object o) { return "object"; }
            public static string M(string s) { return "string"; }
        }
        class Program { static void Main() { Console.WriteLine(C.M("x")); } }
      `,
      { langVersion: '12' },
    ),
    diag(
      'cs9261-cs9262-cs0592-placement',
      cs`
        using System;
        using System.Runtime.CompilerServices;
        class B { public virtual void V(object o) { } public virtual int P { get { return 0; } } }
        class D : B
        {
            [OverloadResolutionPriority(1)] public override void V(object o) { }
            [OverloadResolutionPriority(1)] public override int P { get { return 0; } }
            [OverloadResolutionPriority(1)] public int Q { get { return 0; } }
            [OverloadResolutionPriority(1)] int field;
            [OverloadResolutionPriority(1)] static D() { }
            [OverloadResolutionPriority(1)] ~D() { }
            [OverloadResolutionPriority(1)] public static D operator +(D a, D b) { return a; }
            [OverloadResolutionPriority(1)] public static implicit operator int(D a) { return 0; }
            [OverloadResolutionPriority("x")] void Bad() { }
        }
        interface I { [OverloadResolutionPriority(1)] void M(); }
        class Impl : I { [OverloadResolutionPriority(1)] void I.M() { } }
        class Program { static void Main() { } }
      `,
    ),
  ]),
];
