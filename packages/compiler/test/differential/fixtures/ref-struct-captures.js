/**
 * Differential fixtures for where a ref struct cannot live (SF-A02-T04.5): captured by a lambda, an anonymous method
 * or a local function (CS8175 for a local, CS9108 for a parameter), as a field or auto-property of a type that is not
 * a ref struct (CS8345), and as the element of an array (CS0611).
 */
import { cs, diag, feature } from './kit.js';

export const fixtures = feature('ref-struct-captures', [
  diag(
    'cs8175-cs9108-captured-by-functions',
    cs`
      using System;
      ref struct RS { public int X; public int Get() => X; }
      struct Plain { public int X; }
      static class P
      {
          static void Lambdas(RS p, ref int q, in int z, out int o)
          {
              o = 0;
              RS r = new RS();
              Span<int> span = stackalloc int[2];
              Plain plain = new Plain();
              Func<int> f = () => r.X;
              Func<int> g = () => p.Get();
              Func<int> h = () => span.Length;
              Func<int> i = () => plain.X;
              Action a = delegate { r.X = 1; };
              Func<int> j = () => q;
              Func<int> k = () => z;
              Action l = () => o = 1;
              int Local() => r.X + q;
              static int StaticLocal(RS s) => s.X;
              Func<RS, int> m = s => s.X;
              Func<int> nested = () => { Func<int> inner = () => r.X; return inner(); };
              Local();
              StaticLocal(r);
          }
          static void Main() { }
      }
    `,
  ),
  diag(
    'cs8175-top-level-local',
    cs`
      using System;
      Span<int> numbers = stackalloc int[3];
      int total = numbers.Length;
      Func<int> count = () => numbers.Length + total;
      Console.WriteLine(count());
    `,
  ),
  diag(
    'cs8345-cs0611-fields-and-arrays',
    cs`
      using System;
      ref struct RS { public int X; }
      ref struct Outer
      {
          public RS Inner;
          public Span<int> Items;
          public static RS Shared;
      }
      class Holder
      {
          public RS Field;
          public static RS StaticField;
          public RS Prop { get; set; }
          public RS Computed => new RS();
          public Span<int> Items;
      }
      struct Wrapper { public RS Inner; }
      static class P
      {
          static RS[] Make() => new RS[1];
          static void Main()
          {
              RS[] local = Make();
              Span<int>[] spans = new Span<int>[2];
              Console.WriteLine(local.Length + spans.Length);
          }
      }
    `,
  ),
]);
