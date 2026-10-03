/**
 * Differential fixtures for C# 13 rules (SF-A02-T82): ref locals in iterators and async methods (CS9217 across a
 * yield or await), ref struct interfaces and `allows ref struct` (CS9244, CS0029, CS0315), CS9202 below C# 13.
 */
import { cs, diag, feature } from './kit.js';

const refStructs = cs`
  using System;
  interface IShape { int Area(); }
  ref struct R : IShape { public int W; public int Area() { return W * 2; } }
  struct S : IShape { public int Area() { return 1; } }
  class Program
  {
      static int Plain<T>(T t) where T : IShape { return t.Area(); }
      static int Use<T>(T t) where T : IShape, allows ref struct { return t.Area(); }
      static int Forward<T>(T t) where T : IShape, allows ref struct { return Use(t) + Plain(t); }
      static void Main()
      {
          var r = new R(); r.W = 4;
          Console.WriteLine(Use(r));
          Console.WriteLine(Plain(r));
          Console.WriteLine(Use(new S()) + Plain(new S()));
          IShape s = r;
          object o = r;
          Use<int>(1);
      }
  }
`;

const refLocals = cs`
  using System;
  using System.Collections.Generic;
  using System.Threading.Tasks;
  class Program
  {
      static IEnumerable<int> Crossing()
      {
          int x = 1; ref int r = ref x; yield return x; r = 5;
      }
      static IEnumerable<int> Fine()
      {
          int x = 1; { ref int r = ref x; r = 5; } yield return x; { ref int q = ref x; q++; } yield return x;
      }
      static IEnumerable<int> Rebound()
      {
          int x = 1, y = 2; ref int r = ref x; yield return r; r = ref y; r = 3; yield return y;
      }
      static IEnumerable<int> Loop()
      {
          int x = 1; ref int r = ref x;
          for (int i = 0; i < 2; i++) { r++; yield return x; }
      }
      static IEnumerable<int> LoopLocal()
      {
          int x = 1;
          for (int i = 0; i < 2; i++) { ref int r = ref x; r++; yield return x; }
      }
      static async Task<int> CrossingAwait()
      {
          int x = 1; ref int r = ref x;
          await Task.Delay(1); r = 3; return x;
      }
      static async Task<int> FineAwait()
      {
          int x = 1; { ref int r = ref x; r = 7; }
          await Task.Delay(1); return x;
      }
      static void Main() { }
  }
`;

export const fixtures = [
  ...feature('ref-struct-interfaces', [
    diag('cs9244-cs0029-cs0315', refStructs),
    diag('cs9202-below-csharp-13', refStructs, { langVersion: '12' }),
  ]),
  ...feature('ref-locals-in-iterators-async', [
    diag('cs9217-across-yield-and-await', refLocals),
    diag('cs9202-below-csharp-13', refLocals, { langVersion: '12' }),
  ]),
];
