/**
 * Differential fixtures for SF-A02-T76 (C# 11): checked user-defined operators, the unsigned right shift, generic
 * attributes, file-local types, static abstract interface members and the extended nameof scope.
 * File-local types of the same name in two files are in tests/compiler-csharp11-rules.test.js (one file per fixture).
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('checked-operators', [
    out(
      'a-checked-context-selects-the-checked-operator',
      cs`
    using System;
    class V
    {
        public int X;
        public V(int x) { X = x; }
        public static V operator checked +(V a, V b) => new V(a.X + b.X + 1000);
        public static V operator +(V a, V b) => new V(a.X + b.X);
        public static V operator -(V a, V b) => new V(a.X - b.X);
        public static V operator checked -(V a) => new V(-a.X - 1000);
        public static V operator -(V a) => new V(-a.X);
        public static V operator checked ++(V a) => new V(a.X + 100);
        public static V operator ++(V a) => new V(a.X + 1);
        public static explicit operator checked int(V v) => v.X + 5000;
        public static explicit operator int(V v) => v.X;
    }
    class Program
    {
        static void Main()
        {
            var a = new V(1); var b = new V(2);
            Console.WriteLine((a + b).X);
            Console.WriteLine(checked(a + b).X);
            Console.WriteLine(checked(a - b).X);
            Console.WriteLine((-a).X);
            Console.WriteLine(checked(-a).X);
            Console.WriteLine((int)a);
            Console.WriteLine(checked((int)a));
            checked { var c = a + b; c += a; Console.WriteLine(c.X); c++; Console.WriteLine(c.X); }
            unchecked { var d = a + b; d++; Console.WriteLine(d.X); }
        }
    }
  `,
    ),
    diag(
      'declaration-rules',
      cs`
    class V
    {
        public static V operator checked +(V a, V b) => a;
        public static V operator checked ==(V a, V b) => a;
        public static V operator checked *(V a, V b) => a;
        public static V operator *(V a, V b) => a;
        public static V operator checked /(V a, int b) => a;
        public static V operator /(V a, V b) => a;
        public static explicit operator checked int(V v) => 0;
        public static V operator checked !(V a) => a;
    }
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'checked-operators-in-csharp-10',
      cs`
    class V
    {
        public static V operator checked +(V a, V b) => a;
        public static V operator +(V a, V b) => a;
    }
    class Program { static void Main() { } }
  `,
      { langVersion: '10' },
    ),
  ]),
  ...feature('unsigned-right-shift', [
    out(
      'int-operands',
      cs`
    using System;
    class Box { public int V = -8; public int[] A = { -16, 64 }; }
    class Program
    {
        static int calls;
        static int Next(int v) { calls++; return v; }
        static void Main()
        {
            int x = -8;
            Console.WriteLine(x >>> 1);
            x >>>= 28; Console.WriteLine(x);
            int y = -1;
            Console.WriteLine(y >>> 0);
            Console.WriteLine(y >>> 32);
            Console.WriteLine(y >>> 31);
            Console.WriteLine(y >>> 33);
            Console.WriteLine(y >>> -1);
            Console.WriteLine(1024 >>> 3);
            Console.WriteLine(Next(-256) >>> Next(4));
            Console.WriteLine(calls);
            var b = new Box();
            b.V >>>= 1; Console.WriteLine(b.V);
            b.A[0] >>>= 30; Console.WriteLine(b.A[0]);
            const int K = -2 >>> 1; Console.WriteLine(K);
        }
    }
  `,
    ),
    out(
      'wide-and-unsigned-operands',
      cs`
    using System;
    class Box { public long V = -8; public ulong[] A = { 18446744073709551615, 64 }; }
    class Program
    {
        static void Main(string[] args)
        {
            long zero = args.Length;
            Console.WriteLine(zero >>> 1);
            long n = -8;
            Console.WriteLine(n >>> 1);
            Console.WriteLine(n >>> 64);
            Console.WriteLine(n >>> 65);
            Console.WriteLine(n >>> -1);
            n >>>= 60; Console.WriteLine(n);
            uint u = 4000000000;
            Console.WriteLine(u >>> 3);
            Console.WriteLine(u >>> 32);
            Console.WriteLine(u >>> 33);
            u >>>= 31; Console.WriteLine(u);
            ulong w = 18446744073709551615;
            Console.WriteLine(w >>> 60);
            Console.WriteLine(w >>> 64);
            w >>>= 63; Console.WriteLine(w);
            short s = -2; byte b = 200; sbyte t = -1; ushort h = 65535; char c = 'A';
            Console.WriteLine(s >>> 1);
            Console.WriteLine(b >>> 3);
            Console.WriteLine(t >>> 28);
            Console.WriteLine(h >>> 15);
            Console.WriteLine(c >>> 2);
            var box = new Box();
            box.V >>>= 62; Console.WriteLine(box.V);
            box.A[0] >>>= 1; Console.WriteLine(box.A[0]);
            const long K = -2L >>> 1; Console.WriteLine(K);
            const uint M = 0x80000000 >>> 31; Console.WriteLine(M);
        }
    }
  `,
    ),
    out(
      'user-defined-operator',
      cs`
    using System;
    class V
    {
        public int X;
        public V(int x) { X = x; }
        public static V operator >>>(V a, int n) => new V(a.X + n);
        public static V operator >>(V a, int n) => new V(a.X - n);
    }
    class Program
    {
        static void Main()
        {
            var v = new V(10);
            Console.WriteLine((v >>> 2).X);
            Console.WriteLine((v >> 2).X);
            v >>>= 5; Console.WriteLine(v.X);
        }
    }
  `,
    ),
    diag(
      'cs0019-operand-types',
      cs`
    class Program
    {
        static void Main() { double d = 1; var a = d >>> 1; string s = "s"; var b = s >>> 1; var c = 1 >>> 1.0; }
    }
  `,
    ),
    diag(
      'unsigned-right-shift-in-csharp-10',
      cs`
    class V { public static V operator >>>(V a, int n) => a; public static V operator <<(V a, V b) => a; }
    class Program { static void Main() { int x = 1; x = x >>> 1; x >>>= 2; } }
  `,
      { langVersion: '10' },
    ),
  ]),
  ...feature('generic-attributes', [
    out(
      'constructed-attribute-classes',
      cs`
    using System;
    class MyAttribute<T> : Attribute { public MyAttribute() { } public MyAttribute(T value) { } public T Value { get; set; } }
    class Pair<TA, TB> : Attribute { }
    class Derived<T> : MyAttribute<T> { }
    [My<int>]
    class C
    {
        [My<string>("s")] public void M() { }
        [MyAttribute<int>(Value = 3)] public int F = 1;
        [Pair<int, string>] void N() { }
        [Derived<bool>] void O() { }
        [Obsolete(nameof(count))] public int Twice([My<string>(nameof(count))] int count) => count * 2;
    }
    class Program { static void Main() { Console.WriteLine(new C().F); } }
  `,
    ),
    diag(
      'type-argument-and-arity-rules',
      cs`
    using System;
    using System.Collections.Generic;
    class MyAttribute<T> : Attribute { public MyAttribute() { } public MyAttribute(T value) { } }
    class Plain : Attribute { }
    class G<T> { [My<T>] void M() { } [My<List<T>>] void N() { } }
    [My<int>("s")] class A { }
    [My] class B { }
    [My<int, int>] class D { }
    [Plain<int>] class E { }
    [My<dynamic>] class F { }
    [My<(int a, int b)>] class H { }
    [My<nint>] class I { }
    [My<>] class K { }
    class Program { static void Main() { } }
  `,
    ),
    diag(
      'generic-attributes-in-csharp-10',
      cs`
    using System;
    class MyAttribute<T> : Attribute { }
    class Outer<T> { class Inner : Attribute { } }
    [My<int>] class C { }
    class Program { static void Main() { } }
  `,
      { langVersion: '10' },
    ),
  ]),
  ...feature('file-local-types', [
    out(
      'visible-in-their-file',
      cs`
    using System;
    namespace App
    {
        file class Helper { public static int V => 4; public int Twice(int v) => v * 2; }
        file static class Tools { public static string Name(Helper h) => "h" + h.Twice(2); }
        class Program
        {
            static void Main()
            {
                var h = new Helper();
                Console.WriteLine(Helper.V);
                Console.WriteLine(Tools.Name(h));
                Console.WriteLine(new F().G);
            }
        }
    }
    file class F { public int G = 7; }
  `,
    ),
    diag(
      'signature-nesting-and-accessibility-rules',
      cs`
    file class F { }
    file interface IF { }
    public class G
    {
        public F f;
        public F M() => null;
        void N(F p) { }
        F P { get; set; }
        F[] arr = null;
        System.Collections.Generic.List<F> list = null;
        object Use() => arr ?? (object)list;
    }
    file class H { file class I { } public F Ok = null; }
    public file class J { }
    internal file class J2 { }
    class K : F { }
    class L : IF { }
    file class M : F { }
    file class F2 { } file class F2 { }
    file partial class F3 { } file partial class F3 { }
    delegate F D(F p);
    class Program { static void Main() { F local = new F(); System.Console.WriteLine(local); } }
  `,
    ),
    diag(
      'file-local-types-in-csharp-10',
      cs`
    file class F { }
    class Program { static void Main() { } }
  `,
      { langVersion: '10' },
    ),
  ]),
  ...feature('static-abstract-members', [
    diag(
      'cs0535-cs8928-cs0736-implementations',
      cs`
    interface IMake<T> where T : IMake<T> { static abstract T Make(); static virtual int Version => 1; }
    interface ICount { static abstract int Count { get; } int Size(); }
    class Missing : IMake<Missing> { }
    class Instance : IMake<Instance> { public Instance Make() => null; }
    class Fine : IMake<Fine>, ICount { public static Fine Make() => null; public static int Count => 0; public int Size() => 1; }
    class Mixed : ICount { public int Count => 0; public static int Size() => 1; }
    class Program { static void Main() { } }
  `,
    ),
  ]),
];
