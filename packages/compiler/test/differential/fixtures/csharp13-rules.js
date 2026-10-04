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

const refStructLocals = cs`
  using System.Collections.Generic;
  using System.Threading.Tasks;
  ref struct R { public int V; public int Get() { return V; } }
  class Program
  {
      static int Use(R r) { return r.V; }
      static async Task<int> WholeRead() { R r = new R(); await Task.Delay(1); return Use(r); }
      static async Task<int> Copy() { R r = new R(); await Task.Delay(1); R c = r; return c.V; }
      static async Task<int> Branch(bool b) { R r = new R(); await Task.Delay(1); if (b) r.V = 1; return r.V; }
      static async Task<int> Call() { R r = new R(); await Task.Delay(1); return r.Get(); }
      static async Task<int> InArgument() { R r = new R(); return Use(r) + await Task.FromResult(1); }
      static IEnumerable<int> YieldRead() { R r = new R(); yield return 1; yield return r.V; }
      static async Task<int> AfterAwait() { R r = new R(); await Task.Delay(1); r.V = 1; return r.V; }
      static async Task<int> BeforeAwait() { R r = new R(); r.V = 1; int v = r.V; await Task.Delay(1); return v; }
      static async Task<int> DeclaredAfter() { await Task.Delay(1); R r = new R(); r.V = 1; return r.V; }
      static async Task<int> InLoop() { R r = new R(); for (int i = 0; i < 2; i++) { r.V++; await Task.Delay(1); } return 0; }
      static async Task<int> Reassigned() { R r = new R(); await Task.Delay(1); r = new R(); return r.V; }
      static IEnumerable<int> AfterYield() { R r = new R(); yield return 1; r.V = 2; }
      static IEnumerable<int> BeforeYield() { R r = new R(); r.V = 2; yield return r.V; }
      static IEnumerable<int> Scoped() { { R r = new R(); r.V = 2; } yield return 1; { R r = new R(); r.V = 3; } }
      static void Main() { }
  }
`;
const refStructIteratorLocals = cs`
  using System.Collections.Generic;
  ref struct R { public int V; }
  class Program
  {
      static IEnumerable<int> YieldRead() { R r = new R(); yield return 1; yield return r.V; }
      static IEnumerable<int> BeforeYield() { R r = new R(); r.V = 2; yield return r.V; }
      static void Main() { }
  }
`;
const yieldInUnsafe = cs`
  using System.Collections.Generic;
  class Program
  {
      static IEnumerable<int> InBlock() { unsafe { yield return 1; } }
      static IEnumerable<int> BreakOnly() { unsafe { yield break; } }
      static unsafe IEnumerable<int> UnsafeMethod() { yield return 1; }
      static IEnumerable<int> Outside() { unsafe { int x = 1; int* p = &x; } yield return 1; }
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
    diag('cs4007-ref-struct-local-across-await-or-yield', refStructLocals),
    diag('cs4012-cs4013-ref-struct-locals-below-csharp-13', refStructLocals, { langVersion: '12' }),
    diag('cs4007-ref-struct-iterator-local-csharp-12', refStructIteratorLocals, { langVersion: '12' }),
    diag('cs9238-yield-return-in-unsafe-block', yieldInUnsafe, { allowUnsafe: true }),
    diag('cs1629-unsafe-in-iterator-below-csharp-13', yieldInUnsafe, { allowUnsafe: true, langVersion: '12' }),
  ]),
];
