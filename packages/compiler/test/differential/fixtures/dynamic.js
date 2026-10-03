/**
 * Differential fixtures for `dynamic` (C# 4, SF-A02-T55): operations on a dynamic value are late bound, so valid
 * dynamic code has no diagnostics whatever member, overload or operator it names; the arguments of a dynamically
 * dispatched operation have restrictions of their own; and a value that is only stored and passed on runs like an
 * `object`. The operations themselves need a runtime binder and are SF2200 (the diagnostics fixtures compare the C#
 * diagnostics only).
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('dynamic', [
    out(
      'values-stored-and-passed-as-objects',
      cs`
        using System;
        class Holder
        {
            public dynamic Value;
            public dynamic Other { get; set; }
            public Holder(dynamic value) { Value = value; }
            public dynamic Get() { return Value; }
            public static object Unwrap(dynamic value) { return value; }
        }
        class Program
        {
            static dynamic Pick(bool first, dynamic a, dynamic b) { return first ? a : b; }
            static void Main()
            {
                dynamic d = "text";
                object o = d;
                Console.WriteLine(o);
                var h = new Holder(42);
                object v = h.Get();
                Console.WriteLine(v);
                h.Other = 1.5;
                Console.WriteLine((object)h.Other);
                dynamic[] items = { 1, "two", null };
                object second = items[1];
                Console.WriteLine(second);
                Console.WriteLine(items.Length);
                object picked = Pick(false, "a", "b");
                Console.WriteLine(picked);
                Console.WriteLine(Holder.Unwrap(true));
                dynamic copy = d;
                d = null;
                Console.WriteLine((object)copy ?? "none");
                Console.WriteLine((object)d ?? "none");
            }
        }
      `,
    ),
    diag(
      'late-bound-operations-are-not-checked',
      cs`
        using System;
        using System.Collections.Generic;
        class Box
        {
            public int Value;
            public Box(int v) { Value = v; }
            public Box(string v) { }
            public int Get(int a) { return Value; }
            public int this[int i] { get { return i; } set { } }
            public void Over(int a) { }
            public void Over(string a) { }
        }
        class Program
        {
            static dynamic Field = 1;
            static int Twice(int x) { return x * 2; }
            static string Twice(string x) { return x + x; }
            static int One(int x) { return x; }
            static void Take(object o) { }
            static T Id<T>(T x) { return x; }
            static void Two<T>(T a, T b) { }
            static void Main()
            {
                dynamic d = new Box(3);
                var v = d.Value; d.Value = 4; d.Missing(1, "a"); var w = d.A.B.C; d.E += null; d.P -= 1;
                var x = d[0]; d[1] = 2; d(1, 2); var g = d.M<int>(1); d.Foo(out int n, ref v, name: 1);
                var e = d + 1; var f = d * d; var m = -d; var h = !d; var k = d == null; var l = d && true; d += 2; d++; --d;
                var u = d?.Foo; var u2 = d?.Bar(1)?.Baz; var z = d?[0];
                if (d) { } while (d > 1) { break; } var c = d ? 1 : 2; foreach (var item in d) { item.Foo(); } using (d) { }
                var q = d ?? 1; var r = d is int; var s = d as string; var t = (object)d; var a2 = d as Box; var a3 = d as int?;
                string str = d; int i = d; long lng = d; Box b = d; double dbl = d + 1.5; Action act = d.Foo; Func<int, int> fn = d;
                switch (d) { case 1: break; default: break; }
                lock (d) { }

                // A dynamic argument: the overload is chosen at run time, and the result is dynamic.
                var t1 = Twice(d); t1.Foo(); var t2 = One(d); t2.Foo(); Take(d); var t3 = Id(d); t3.Foo(); Two(d, 1);
                var box = new Box(d); box.Over(d); var t4 = box.Get(d); t4.Foo(); var t5 = box[d]; t5.Foo();
                box.Value = d; box.Value += d; var t6 = box.Value + d; t6.Foo(); var t7 = Field + d; Field.Foo();
                var t8 = true ? d : 1; t8.Foo(); var t9 = new[] { d, 1 }; t9[0].Foo(); var t10 = (d, 1); t10.Item1.Foo();
                var list = new List<dynamic>(); list.Add(d); list[0].Foo();
                Func<dynamic, dynamic> lambda = p => p + 1; var t11 = lambda(d); t11.Foo();
                Console.WriteLine(d); Console.WriteLine("{0}", d); var abs = Math.Abs(d); abs.Foo();
                int unused = 0;
            }
        }
      `,
    ),
    diag(
      'cs1061-cs1501-what-stays-statically-bound',
      cs`
        using System;
        class Box
        {
            public Box(int v) { }
            public Box(string v) { }
        }
        class Program
        {
            static int One(int x) { return x; }
            static void Take(object o) { }
            static void Main()
            {
                dynamic d = 2;
                object o = d; o.Foo();
                int i = d.Foo(); i.Bar();
                var cast = (string)d; cast.Baz();
                var box = new Box(d); box.Missing();
                int[] array = { 1 }; var element = array[d]; element.Qux();
                foreach (string s in d) { s.Quux(); }
                int Local(int x) => x;
                var local = Local(d); local.Corge();
                var a = One(d, d);
                Take(d, d);
                int k;
                d.Foo(ref k);
                dynamic unassigned;
                Console.WriteLine(unassigned);
            }
        }
      `,
    ),
    diag(
      'cs1973-cs1976-cs1977-cs1978-arguments-of-a-dynamic-operation',
      cs`
        using System;
        static class Extensions
        {
            public static int Twice(this string s, object o) { return 1; }
        }
        class Program
        {
            static void Take(object o) { }
            static void Main()
            {
                dynamic d = 2;
                var a = "a".Twice(d);
                d.Foo(x => x);
                d.Foo(delegate { });
                d.Foo(Console.WriteLine);
                d.Foo(Take(1));
                d.Foo(in d);
                d.Foo(out var declared);
                d.Foo(out _);
                d.Foo(default);
                var b = d[x => x];
                var c = d?.Foo(x => 1);
                var e = d.Foo<int>;
                var f = d + (() => 1);
                var g = d + Take;
                d.Foo = x => x;
                d.Bar((Action)(() => { }), Extensions.Twice("a", d), null);
            }
        }
      `,
    ),
    diag(
      'cs1962-cs1981-cs8386-cs8133-the-dynamic-type-itself',
      cs`
        using System;
        using System.Threading.Tasks;
        class Program
        {
            static async Task Run(dynamic d)
            {
                var awaited = await d;
                awaited.Foo();
                await foreach (var x in d) { }
            }
            static void Main()
            {
                dynamic d = 2;
                var t = typeof(dynamic);
                var arrayType = typeof(dynamic[]);
                var test = d is dynamic;
                var created = new dynamic();
                var (a, b) = d;
                var size = default(dynamic);
                size.Foo();
            }
        }
      `,
    ),
    diag(
      'cs1965-cs1966-cs1967-cs1968-dynamic-in-declarations',
      cs`
        using System;
        using System.Collections.Generic;
        class A : dynamic { }
        class B : List<dynamic> { }
        interface I<T> { }
        class C : I<dynamic> { }
        class D<T> where T : dynamic { }
        class E<T> where T : List<dynamic> { }
        class Program
        {
            static void Main()
            {
                const dynamic none = null;
                const dynamic one = 1;
                const object boxed = 2;
            }
        }
      `,
    ),
    diag(
      'cs0111-cs1964-cs1971-cs1975-dynamic-is-object-in-signatures',
      cs`
        using System;
        class Program
        {
            void M(dynamic x) { }
            void M(object x) { }
            static dynamic operator +(Program a, dynamic b) { return a; }
            public static implicit operator Program(dynamic d) { return null; }
            static void Main() { }
        }
        class Derived : BaseC
        {
            public override dynamic Get(object x) { return x; }
            public override object Get2(dynamic x) { return x; }
            public Derived(dynamic d) : base(d) { }
            public Derived(int i) : base(i) { }
            void Test(dynamic d) { base.Over(d); base.One(d); base.One(1); }
        }
        class BaseC
        {
            public virtual object Get(dynamic x) { return x; }
            public virtual dynamic Get2(object x) { return x; }
            public BaseC(int x) { }
            public BaseC(string x) { }
            public void Over(int x) { }
            public void Over(string x) { }
            public void One(int x) { }
        }
      `,
    ),
    diag(
      'cs1963-cs1979-expression-trees-and-queries',
      cs`
        using System;
        using System.Linq.Expressions;
        class Program
        {
            static void Main()
            {
                dynamic d = 2;
                Expression<Func<dynamic, dynamic>> member = x => x.Foo;
                Expression<Func<int>> conversion = () => d;
                Expression<Func<dynamic>> operation = () => d + 1;
                Expression<Func<object>> element = () => d[0];
                Expression<Func<dynamic, object>> identity = x => x;
                var query = from x in d select x;
            }
        }
      `,
    ),
  ]),
];
