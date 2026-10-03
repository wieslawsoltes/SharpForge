/**
 * Differential fixtures for implicit typing (SF-A02-T52): `var` locals (CS0815, CS0818, CS0819, CS0820, CS0822,
 * CS0825, CS0841, CS8716, CS8917), implicitly typed arrays and their best common type (CS0826, and CS0037 on the
 * element that does not convert), the type of a conditional expression (CS0173) and, from C# 10, the natural
 * delegate type of a lambda or method group initializer.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = feature('implicit-types', [
  out(
    'var-locals-loops-and-arrays',
    cs`
      using System;
      class Program
      {
          static void Main()
          {
              var i = 1;
              var s = "a";
              var d = 1.5;
              var a = new[] { 1, 2, 3 };
              var b = new[] { 1, 2.5 };
              var c = new[] { "x", null };
              var t = true ? 1 : 2.5;
              Console.WriteLine(i + s + d);
              Console.WriteLine(a.Length + " " + b[1] + " " + c.Length + " " + t);
              var j = new[] { new[] { 1 }, new[] { 2, 3 } };
              Console.WriteLine(j[1].Length);
              foreach (var x in a) Console.Write(x);
              Console.WriteLine();
              for (var k = 0; k < 2; k++) Console.Write(k);
              Console.WriteLine();
          }
      }
    `,
  ),
  out(
    'best-common-type-of-array-elements',
    cs`
      using System;
      class Program
      {
          static void Main()
          {
              var a = new[] { 1, 2.5, 3 };
              var b = new[] { "a", null, "c" };
              var c = new[] { new[] { 1 }, new int[0] };
              object o = "o";
              var d = new[] { "s", o };
              var e = true ? 1 : 2.5;
              var f = false ? "s" : null;
              var g = new[] { (object)1, "two" };
              Console.WriteLine(a[1] + " " + b.Length + " " + c.Length + " " + d[1] + " " + e + " " + (f == null) + " " + g[1]);
              int[] h = { 1, 2 };
              var i = h;
              Console.WriteLine(i.Length);
          }
      }
    `,
  ),
  out(
    'natural-delegate-type-of-var-initializer',
    cs`
      using System;
      class Program
      {
          static int Twice(int x) { return x * 2; }
          static void Main()
          {
              var f = (int x) => x + 1;
              var g = Twice;
              var h = () => "h";
              Console.WriteLine(f(1) + g(2) + h());
          }
      }
    `,
  ),
  diag(
    'cs0815-cs0818-cs0819-cs0820-initializer-forms',
    cs`
      class Program
      {
          static void M() { }
          static void Main()
          {
              var a;
              var b = null;
              var c = M();
              var e = { 1, 2 };
              var f = 1, g = 2;
              var t = (1, null);
              for (var i = 0, j = 1; i < 1; i++) { }
          }
      }
    `,
  ),
  diag(
    'cs0822-cs8716-const-var-and-default',
    cs`
      class Program
      {
          static void Main()
          {
              const var c = 1;
              var d = default;
          }
      }
    `,
  ),
  diag(
    'cs0825-var-outside-a-local-declaration',
    cs`
      class Program
      {
          var field = 1;
          var Prop { get; set; }
          var M(var p) { return p; }
          static void Main()
          {
              var[] q = new int[1];
              var? n = 1;
          }
      }
    `,
  ),
  diag(
    'cs0841-used-before-declaration',
    cs`
      class Program
      {
          static void Main()
          {
              int z = y;
              int y = 1;
              var w = (w = 1);
              var v = v;
              int u = u + 1;
              {
                  k = 2;
              }
              int k;
          }
      }
    `,
  ),
  diag(
    'cs8917-no-natural-delegate-type',
    cs`
      class Program
      {
          static void G() { }
          static void G(int x) { }
          static void Main()
          {
              var b = x => x;
              var d = G;
              var e = delegate { };
              object o = x => x;
          }
      }
    `,
  ),
  diag(
    'cs8773-inferred-delegate-type-in-csharp-9',
    cs`
      using System;
      class Program
      {
          static int F(int x) { return x; }
          static void Main()
          {
              var a = () => 1;
              var b = x => x;
              var c = F;
              var e = delegate { };
              var g = (int x) => x;
              Delegate d = () => 2;
              object o = () => 3;
              Delegate h = F;
              var i = new[] { F };
          }
      }
    `,
    { langVersion: '9' },
  ),
  diag(
    'cs0826-cs0037-no-best-type',
    cs`
      class Program
      {
          static void Main()
          {
              var a = new[] { };
              var b = new[] { 1, "a" };
              var c = new[] { null };
              var d = new[] { null, null };
              var e = new[] { 1, null };
              var f = new[] { x => x };
              var g = new[] { default, null };
          }
      }
    `,
  ),
  diag(
    'cs0826-cs0173-unrelated-classes',
    cs`
      class A { }
      class B : A { }
      class C : A { }
      class Program
      {
          static void Main()
          {
              var x = new[] { new B(), new A() };
              var y = new[] { new B(), new C() };
              var z = true ? new B() : new C();
              var t = true ? 1 : "a";
              var u = true ? null : null;
              var l = true ? x => x : null;
              object ok = true ? null : "a";
          }
      }
    `,
  ),
  diag(
    'cs0029-a-type-named-var-wins',
    cs`
      class var { }
      class Program
      {
          static void Main()
          {
              var v = new var();
              var w = 1;
          }
      }
    `,
  ),
  diag(
    'cs8023-var-and-implicit-array-in-csharp-2',
    cs`
      class Program
      {
          static void Main()
          {
              var x = 1;
              var a = new[] { 1, 2 };
              System.Console.WriteLine(x + a.Length);
          }
      }
    `,
    { langVersion: '2' },
  ),
]);
