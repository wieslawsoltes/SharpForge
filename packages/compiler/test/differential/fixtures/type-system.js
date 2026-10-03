/**
 * Differential fixtures for the type system and binding epic (SF-A02-E01): numeric lattice, generics, inheritance and
 * interface dispatch, structs and by-reference rules, nullable analysis, overload and conversion resolution.
 * Diagnostics fixtures are compared with Roslyn; output fixtures are valid programs the semantic analysis must accept.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('numeric-lattice', [
    out(
      'promotion-and-widths',
      cs`
        using System;
        byte b = 200; sbyte sb = -5; short s = 1000; ushort us = 60000; uint u = 4000000000; long l = 5000000000; ulong ul = 18000000000000000000;
        int sum = b + b;
        long mixed = u + 1 - 2 + s;
        ulong big = ul + 1;
        float f = 1.5f; double d = f + 1; decimal m = 2.5m + 1;
        char c = 'a'; int code = c + 1;
        Console.WriteLine(sum + " " + mixed + " " + big + " " + d + " " + m + " " + code + " " + sb + us + l);
      `,
    ),
    diag(
      'cs0034-ulong-plus-int',
      cs`
        ulong a = 1; int b = 2;
        var c = a + b;
      `,
    ),
    diag(
      'cs0031-byte-constant',
      cs`
        byte ok = 200;
        byte bad = 300;
        sbyte neg = -129;
        uint minus = -1;
      `,
    ),
    diag(
      'cs0266-narrowing',
      cs`
        long l = 5; int i = l;
        double d = 1.5; float f = d;
        uint u = 3000000000; int j = u;
      `,
    ),
    diag(
      'cs0023-negate-ulong',
      cs`
        ulong a = 1;
        var b = -a;
      `,
    ),
    diag(
      'cs0019-decimal-double',
      cs`
        decimal m = 1; double d = 2;
        var x = m + d;
      `,
    ),
    diag(
      'cs0220-checked-constant-overflow',
      cs`
        int a = int.MaxValue + 1;
        byte b = (byte)300;
      `,
    ),
  ]),
  ...feature('enums', [
    diag(
      'cs0266-int-to-enum',
      cs`
        Color c = 1;
        Color zero = 0;
        int n = Color.Red;
        enum Color { Red, Green }
      `,
    ),
    diag(
      'cs0019-enum-times-int',
      cs`
        var x = Color.Red * 2;
        var ok = Color.Red | Color.Green;
        var diff = Color.Green - Color.Red;
        enum Color { Red = 1, Green = 2 }
      `,
    ),
    diag(
      'cs0543-enum-overflow',
      cs`
        enum Small : byte { A = 255, B }
        enum Bad : byte { A = 256 }
      `,
    ),
  ]),
  ...feature('generics', [
    out(
      'box-and-swap',
      cs`
        using System;
        var box = new Box<int>(41);
        int a = 1, b = 2;
        Util.Swap(ref a, ref b);
        Console.WriteLine(box.Value + 1 + " " + a + b + " " + Util.First(new[] { "x", "y" }));
        class Box<T> { public T Value; public Box(T value) { Value = value; } }
        static class Util
        {
            public static void Swap<T>(ref T x, ref T y) { T t = x; x = y; y = t; }
            public static T First<T>(T[] items) { return items[0]; }
        }
      `,
    ),
    diag(
      'cs0452-cs0453-constraints',
      cs`
        var a = new RefOnly<int>();
        var b = new ValOnly<string>();
        var c = new NeedsNew<NoDefault>();
        class RefOnly<T> where T : class { }
        class ValOnly<T> where T : struct { }
        class NeedsNew<T> where T : new() { }
        class NoDefault { public NoDefault(int x) { } }
      `,
    ),
    diag(
      'cs0315-value-type-constraint',
      cs`
        var a = new Holder<int>();
        var b = new Holder<Dog>();
        class Animal { }
        class Dog : Animal { }
        class Holder<T> where T : Animal { }
      `,
    ),
    diag(
      'cs1961-variance',
      cs`
        interface IProducer<out T> { T Get(); void Put(T item); }
        interface IConsumer<in T> { void Put(T item); T Get(); }
      `,
    ),
    diag(
      'cs0411-and-explicit-arguments',
      cs`
        var a = Util.Make<int>();
        var b = Util.Make();
        var c = Util.Pair(1, "x");
        static class Util
        {
            public static T Make<T>() { return default(T); }
            public static T Pair<T>(T x, T y) { return x; }
        }
      `,
    ),
  ]),
  ...feature('inheritance', [
    diag(
      'cs0239-cs0507-overrides',
      cs`
        class A { public virtual void M() { } protected virtual void N() { } public virtual int P { get { return 0; } } }
        class B : A { public sealed override void M() { } public override void N() { } }
        class C : B { public override void M() { } public override long P { get { return 0; } } }
      `,
    ),
    diag(
      'cs0108-cs0109-hiding',
      cs`
        class A { public int X; public void M() { } public virtual void V() { } }
        class B : A { public int X; public void M() { } public void V() { } public new int Y; }
      `,
    ),
    diag(
      'cs0513-cs0500-abstract',
      cs`
        class A { public abstract void M(); }
        abstract class B { public abstract void M() { } public void N(); }
      `,
    ),
    diag(
      'cs0540-cs0539-explicit-implementation',
      cs`
        interface I { void M(); }
        interface J { void N(); }
        class C : I { void I.M() { } void J.N() { } void I.Missing() { } }
      `,
    ),
    diag(
      'cs0029-cs0030-reference-conversions',
      cs`
        Animal a = new Dog();
        Dog d = a;
        Cat c = (Cat)new Dog();
        object o = a; string s = (string)o;
        class Animal { } class Dog : Animal { } class Cat : Animal { }
      `,
    ),
  ]),
  ...feature('structs', [
    diag(
      'cs0523-layout-cycle',
      cs`
        struct A { public B b; }
        struct B { public A a; }
        struct Ok { public int x; public Ok[] many; }
      `,
    ),
    diag(
      'cs1612-cs0200-member-of-rvalue',
      cs`
        var h = new Holder();
        h.P.X = 1;
        h.F.X = 2;
        h.ReadOnly = 3;
        struct Point { public int X; }
        class Holder { public Point F; public Point P { get; set; } public int ReadOnly { get { return 0; } } }
      `,
    ),
    diag(
      'cs1510-cs0206-ref-arguments',
      cs`
        var h = new Holder();
        int x = 0;
        Util.Inc(ref x);
        Util.Inc(ref 5);
        Util.Inc(ref h.P);
        Util.Inc(x);
        Util.Take(ref x);
        class Holder { public int P { get; set; } }
        static class Util { public static void Inc(ref int v) { v++; } public static void Take(int v) { } }
      `,
    ),
    diag(
      'cs8340-readonly-struct',
      cs`
        readonly struct P { public int X; public readonly int Y; public int Z { get; set; } }
      `,
    ),
    diag(
      'cs0191-cs1648-readonly',
      cs`
        class C
        {
            readonly int r; readonly S s;
            C() { r = 1; s.V = 1; }
            void M() { r = 2; s.V = 2; }
        }
        struct S { public int V; }
      `,
    ),
  ]),
  ...feature('nullable', [
    diag(
      'cs0037-cs0266-nullable-values',
      cs`
        int? a = 5; int? none = null;
        int b = a;
        int c = (int)a;
        long? wide = a;
        int bad = null;
        bool? flag = a > 3;
        bool sure = a > 3;
      `,
    ),
    diag(
      'cs8600-cs8602-flow',
      cs`
        #nullable enable
        class C
        {
            static int Len(string? s) { return s.Length; }
            static int Safe(string? s) { if (s == null) return 0; return s.Length; }
            static string Name(string? s) { string t = s; return s ?? "x"; }
        }
      `,
    ),
  ]),
  ...feature('overload-resolution', [
    diag(
      'cs0121-better-conversion',
      cs`
        Util.F(1, 2);
        Util.G(1);
        Util.H(null);
        static class Util
        {
            public static void F(int a, long b) { } public static void F(long a, int b) { }
            public static void G(long a) { } public static void G(double a) { }
            public static void H(string s) { } public static void H(object o) { }
        }
      `,
    ),
    diag(
      'cs1739-cs1744-named-arguments',
      cs`
        Util.F(b: 2, a: 1);
        Util.F(1, c: 3);
        Util.F(1, a: 2);
        Util.F(a: 1);
        static class Util { public static void F(int a, int b = 5) { } }
      `,
    ),
    diag(
      'cs0457-cs0029-user-conversions',
      cs`
        Meters m = 5;
        int back = m;
        int ok = (int)m;
        Feet f = m;
        struct Meters
        {
            public int V;
            public static implicit operator Meters(int v) { return new Meters(); }
            public static explicit operator int(Meters m) { return m.V; }
        }
        struct Feet { }
      `,
    ),
    diag(
      'cs0019-user-operators',
      cs`
        var a = new V(); var b = new V();
        var sum = a + b;
        var bad = a - b;
        var scaled = a * 2;
        struct V
        {
            public static V operator +(V x, V y) { return x; }
            public static V operator *(V x, int k) { return x; }
        }
      `,
    ),
    diag(
      'cs0123-cs0407-method-groups',
      cs`
        Op ok = Util.Add;
        Op wrongArity = Util.Neg;
        Op wrongReturn = Util.Text;
        delegate int Op(int a, int b);
        static class Util
        {
            public static int Add(int a, int b) { return a + b; }
            public static int Neg(int a) { return -a; }
            public static string Text(int a, int b) { return ""; }
        }
      `,
    ),
    diag(
      'cs1061-extension-scope',
      cs`
        namespace Lib { public static class Ext { public static int Twice(this int x) { return x * 2; } } }
        namespace App
        {
            using Lib;
            class P { static int M() { return 2.Twice() + "s".Twice(); } }
        }
        namespace Other { class Q { static int M() { return 2.Twice(); } } }
      `,
    ),
  ]),
];
