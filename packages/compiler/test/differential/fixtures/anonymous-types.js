/**
 * Differential fixtures for anonymous types (SF-A02-T53): creation with named and inferred members, structural
 * identity (same names, types and order), ToString, Equals, reference equality, nesting, arrays; the transparent
 * identifiers of a query (`let`, a second `from`), which are anonymous types; CS0746, CS0828, CS0833, CS0200, CS0029
 * between different shapes, CS0826.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = feature('anonymous-types', [
  out(
    'creation-identity-text-and-equality',
    cs`
      using System;
      class P { public int X = 4; public string Y { get { return "y"; } } }
      class Program
      {
          static int Count;
          static int Next() { Count++; return Count; }
          static void Main()
          {
              var a = new { Name = "x", Age = 3 };
              Console.WriteLine(a.Name + a.Age);
              Console.WriteLine(a);
              var b = new { Name = "x", Age = 3 };
              Console.WriteLine(a.Equals(b));
              Console.WriteLine(a == b);
              Console.WriteLine(a.Equals(null));
              a = b;
              Console.WriteLine(a == b);
              var e = new { };
              Console.WriteLine(e);
              var p = new P();
              int local = 7;
              var c = new { p.X, p.Y, local };
              Console.WriteLine(c.X + c.Y + c.local);
              Console.WriteLine(c);
              var n = new { Inner = new { V = 1 }, S = (string)null, D = 1.5, B = true };
              Console.WriteLine(n);
              Console.WriteLine(n.Inner.V + " " + n.ToString());
              var arr = new[] { new { K = 1 }, new { K = 2 } };
              Console.WriteLine(arr[1].K + arr.Length);
              Console.WriteLine($"{a} and {arr[0]}");
              var order = new { First = Next(), Second = Next() };
              Console.WriteLine(order.First + " " + order.Second);
              var x = new { A = 1, B = "s" };
              var y = new { B = "s", A = 1 };
              Console.WriteLine(x + " " + y);
              Func<int, int> twice = v => new { V = v * 2 }.V;
              Console.WriteLine(twice(4));
          }
      }
    `,
  ),
  out(
    'transparent-identifiers-of-a-query',
    cs`
      using System;
      class One<T>
      {
          public T Value;
          public One(T value) { Value = value; }
          public One<R> Select<R>(Func<T, R> selector) { return new One<R>(selector(Value)); }
          public One<T> Where(Func<T, bool> predicate) { Console.WriteLine("where " + predicate(Value)); return this; }
          public One<R> SelectMany<C, R>(Func<T, One<C>> collection, Func<T, C, R> result) { return new One<R>(result(Value, collection(Value).Value)); }
      }
      class Program
      {
          static void Main()
          {
              var a = new One<int>(3);
              var b = new One<string>("s");
              var q1 = from x in a let y = x * 2 where y > x select "v" + (x + y);
              Console.WriteLine(q1.Value);
              var q2 = from x in a from s in b let z = s + x where z.Length > 1 select z + x;
              Console.WriteLine(q2.Value);
              var q3 = from x in a select new { x, Twice = x * 2 };
              Console.WriteLine(q3.Value);
              Console.WriteLine(q3.Value.Twice);
          }
      }
    `,
  ),
  diag(
    'cs0746-cs0828-cs0833-member-declarators',
    cs`
      using System;
      class P
      {
          public int X = 1;
          static void M() { }
          static void Main()
          {
              var p = new P();
              var a = new { 1 };
              var b = new { p.X, X = 2 };
              var c = new { N = null };
              var d = new { F = M };
              var e = new { L = x => x };
              var f = new { V = M() };
              var g = new { M() };
              var h = new { A = 1 };
              h.A = 2;
              var i = new { A = 1, B = "s" };
              i = new { B = "s", A = 1 };
              int n = h;
              var j = new { p.X + 1 };
              var k = new { this.X };
              const object z = new { A = 1 };
              var l = new { A = 1 }.Missing;
              var arr = new[] { new { K = 1 }, new { K = "s" } };
              var m = new { h.A, p?.X };
          }
      }
    `,
  ),
]);
