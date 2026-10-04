/**
 * Differential fixtures for the remainder of SF-A02-T72, T77 and T78: `[ModuleInitializer]` on a local function,
 * covariant return overrides through a constructed generic base, UTF-8 string literals, auto-default structs at
 * C# 10 and 11, and `scoped` / `[UnscopedRef]` in ref safety with the C# 11 gate of `scoped`.
 */
import { cs, diag, feature } from './kit.js';

const structsAndScopes = cs`
  using System;
  using System.Diagnostics.CodeAnalysis;
  struct Point
  {
      public int X;
      public int Y;
      public int Auto { get; }
      public Point(int x) { X = x; }
      public Point(int x, int y) { Console.WriteLine(Y); X = x; Y = y; }
      public Point(string s) : this(1) { }
      public Point(double d) { this = default; }
      public Point(long l) { Use(this); X = 1; Y = 2; Auto = 3; }
      public Point(char c) { X = 1; int a = Auto; Y = a; }
      static void Use(Point p) { }
  }
  ref struct Holder
  {
      public ref int Value;
      public Holder(ref int value) { Value = ref value; }
      public ref int Leak() => ref Value;
      [UnscopedRef] public ref int Self() => ref Value;
  }
  struct Plain
  {
      int field;
      public ref int Bad() => ref field;
      [UnscopedRef] public ref int Good() => ref field;
      public ref int Param(scoped ref int p) => ref p;
      public ref int Unscoped([UnscopedRef] out int p) { p = 1; return ref p; }
      public ref int Out(out int p) { p = 1; return ref p; }
  }
  class Program
  {
      static ref int Pick(scoped ref int a, ref int b) => ref b;
      static ref int Wrong(scoped ref int a, ref int b) => ref a;
      static Span<int> Local() { scoped Span<int> s = stackalloc int[2]; return s; }
      static void Main() { }
  }
`;

export const fixtures = [
  ...feature('covariant-returns', [
    diag(
      'generic-base-and-local-module-initializer',
      cs`
        using System;
        using System.Runtime.CompilerServices;
        class Animal { }
        class Cat : Animal { public int Lives = 9; }
        interface IShape { }
        struct Square : IShape { }
        class Base<T>
        {
            public virtual Animal Make() => new Animal();
            public virtual T Item => default(T);
            public virtual object Boxed() => null;
            public virtual IShape Shape() => null;
            public virtual Animal Settable { get; set; }
            public virtual long Wide() => 1;
        }
        class Derived : Base<Animal>
        {
            public override Cat Make() => new Cat();
            public override Cat Item => new Cat();
            public override string Boxed() => "s";
            public override Square Shape() => new Square();
            public override Cat Settable { get; set; }
            public override int Wide() => 1;
        }
        class More : Derived
        {
            public override Animal Make() => null;
            public override Cat Item => null;
        }
        class Program
        {
            static void Main()
            {
                var d = new Derived();
                Cat c = d.Make();
                Console.WriteLine(d.Make().Lives + d.Item.Lives + d.Boxed().Length);
                [ModuleInitializer] static void Init() { }
                Init();
            }
        }
      `,
    ),
  ]),
  ...feature('utf8-literals', [
    diag(
      'type-and-conversions',
      cs`
        using System;
        class Program
        {
            const string Name = "n";
            static void Main()
            {
                ReadOnlySpan<byte> a = "hello"u8;
                var b = "x"u8;
                Console.WriteLine(a.Length + b.Length);
                ReadOnlySpan<byte> joined = "ab"u8 + "cd"u8;
                ReadOnlySpan<byte> three = "a"u8 + ("b"u8 + "c"u8);
                ReadOnlySpan<byte> bad = "ab"u8 + "cd";
                byte[] array = "abc"u8;
                string s = "abc"u8;
                ReadOnlySpan<byte> fromConst = Name;
                object o = "x"u8;
                ReadOnlySpan<byte> raw = """raw"""u8;
                Console.WriteLine(joined.Length + three.Length);
            }
        }
      `,
    ),
    diag(
      'gate-below-11',
      cs`
        class Program
        {
            static void Main() { var b = "x"u8; }
        }
      `,
      { langVersion: '10' },
    ),
  ]),
  ...feature('struct-defaults-and-scoped', [
    diag('csharp-11', structsAndScopes),
    diag('csharp-10', structsAndScopes, { langVersion: '10' }),
  ]),
];
