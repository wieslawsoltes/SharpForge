/**
 * Tuples of more than seven elements (SF-A02-T08.4): `(T1..T9)` is `ValueTuple<T1..T7, ValueTuple<T8, T9>>`. The
 * elements from the eighth on are reached as `ItemN` (or by name) and through `Rest`.
 */
import { cs, out, diag, feature } from './kit.js';

const list = [
  out(
    'elements-names-and-rest',
    cs`
    using System;
    class Program {
      static (int, int, int, int, int, int, int, int, string) Make() { return (1, 2, 3, 4, 5, 6, 7, 8, "nine"); }
      static int Sum((int a, int b, int c, int d, int e, int f, int g, int h, int i, int j) t) {
        return t.a + t.b + t.c + t.d + t.e + t.f + t.g + t.h + t.i + t.j;
      }
      static void Main() {
        var big = (1, 2, 3, 4, 5, 6, 7, 8, 9);
        Console.WriteLine(big.Item9);
        Console.WriteLine(big.Item8 + big.Item1);
        Console.WriteLine(big.Rest.Item1);
        Console.WriteLine(big.Rest);
        Console.WriteLine(big);
        (int a, int b, int c, int d, int e, int f, int g, int h, int i, int j) named = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
        Console.WriteLine(named.j + named.h);
        Console.WriteLine(named.Item10 + named.Rest.Item3);
        Console.WriteLine(Sum(named));
        var made = Make();
        Console.WriteLine(made.Item9);
        Console.WriteLine(made.Item9.Length + made.Item8);
        int x = 80, y = 90;
        var inferred = (1, 2, 3, 4, 5, 6, 7, x, y);
        Console.WriteLine(inferred.x + inferred.y);
      }
    }
    `,
  ),
  out(
    'stores-and-copies',
    cs`
    using System;
    class Holder { public (int, int, int, int, int, int, int, int, int) Field; }
    class Program {
      static void Main() {
        var big = (1, 2, 3, 4, 5, 6, 7, 8, 9);
        var copy = big;
        big.Item9 = 90;
        big.Item1 = 10;
        big.Rest.Item1 = 80;
        Console.WriteLine(big);
        Console.WriteLine(copy);
        var rest = big.Rest;
        rest.Item2 = -1;
        Console.WriteLine(rest);
        Console.WriteLine(big.Rest);
        big.Rest = (800, 900);
        Console.WriteLine(big);
        big.Item8 += 5;
        big.Item9++;
        Console.WriteLine(big.Item8 + " " + big.Item9);
        var holder = new Holder();
        Console.WriteLine(holder.Field);
        holder.Field.Item9 = 7;
        holder.Field.Rest.Item1 = 6;
        Console.WriteLine(holder.Field);
        var items = new (int, int, int, int, int, int, int, int)[2];
        items[1].Item8 = 4;
        Console.WriteLine(items[0]);
        Console.WriteLine(items[1]);
        Console.WriteLine(items[1].Rest);
      }
    }
    `,
  ),
  out(
    'equality-conversion-deconstruction',
    cs`
    using System;
    class Program {
      static (double, double, double, double, double, double, double, double, double) Widen((int, int, int, int, int, int, int, int, int) t) { return t; }
      static void Main() {
        var big = (1, 2, 3, 4, 5, 6, 7, 8, 9);
        Console.WriteLine(big == (1, 2, 3, 4, 5, 6, 7, 8, 9));
        Console.WriteLine(big != (1, 2, 3, 4, 5, 6, 7, 8, 0));
        Console.WriteLine(big == (1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0));
        var wide = Widen(big);
        Console.WriteLine(wide.Item9 / 2);
        (double, object, int, int, int, int, int, int, string) mixed = (1, "two", 3, 4, 5, 6, 7, 8, null);
        Console.WriteLine(mixed.Item2 + "|" + (mixed.Item9 == null));
        var (a, b, c, d, e, f, g, h, i) = big;
        Console.WriteLine(a + b + c + d + e + f + g + h + i);
        int p, q;
        (p, _, _, _, _, _, _, _, q) = big;
        Console.WriteLine(p + " " + q);
        var sixteen = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
        Console.WriteLine(sixteen.Item16 + sixteen.Rest.Rest.Item2 + sixteen.Rest.Item1);
        Console.WriteLine(sixteen);
        var eight = (1, 2, 3, 4, 5, 6, 7, "eight");
        Console.WriteLine(eight.Item8 + eight.Rest.Item1);
        Console.WriteLine(eight.Rest);
      }
    }
    `,
  ),
  out(
    'patterns',
    cs`
    using System;
    class Program {
      static string Describe((int, int, int, int, int, int, int, int, int) t) {
        switch (t) {
          case (1, _, _, _, _, _, _, _, 9): return "one to nine";
          case (_, _, _, _, _, _, _, 8, var last): return "eight then " + last;
          default: return "other";
        }
      }
      static void Main() {
        Console.WriteLine(Describe((1, 2, 3, 4, 5, 6, 7, 8, 9)));
        Console.WriteLine(Describe((0, 2, 3, 4, 5, 6, 7, 8, 5)));
        Console.WriteLine(Describe((0, 0, 0, 0, 0, 0, 0, 0, 0)));
        var t = (1, 2, 3, 4, 5, 6, 7, 8, 9);
        Console.WriteLine(t is (1, 2, 3, 4, 5, 6, 7, 8, 9));
        Console.WriteLine(t is (_, _, _, _, _, _, _, _, > 9));
      }
    }
    `,
  ),
  diag(
    'element-errors',
    cs`
    class Program {
      static void Main() {
        var big = (1, 2, 3, 4, 5, 6, 7, 8, 9);
        int a = big.Item10;
        int b = big.Rest.Item3;
        string c = big.Item9;
        var d = big.Rest.Rest;
        (int, int, int, int, int, int, int, int Item9, int Item8) wrong = big;
        (int, int, int, int, int, int, int, int Rest, int x, int x) repeated = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
        System.Console.WriteLine(repeated);
        var eight = (1, 2, 3, 4, 5, 6, 7, 8);
        int e = eight.Item9;
        int f = eight.Rest.Item2;
      }
    }
    `,
  ),
  diag(
    'conversion-and-arity-errors',
    cs`
    class Program {
      static void Main() {
        var big = (1, 2, 3, 4, 5, 6, 7, 8, 9);
        (int, int, int, int, int, int, int, int) shorter = big;
        (int, int, int, int, int, int, int, int, string) other = big;
        (int, int, int, int, int, int, int, int, string) literal = (1, 2, 3, 4, 5, 6, 7, 8, 9);
        bool same = big == (1, 2, 3, 4, 5, 6, 7, 8);
        var (a, b, c, d, e, f, g, h) = big;
        (short, int, int, int, int, int, int, int, short) narrow = big;
        System.ValueTuple<int, int, int, int, int, int, int, System.ValueTuple<int, int>> same9 = big;
        System.ValueTuple<int, int, int, int, int, int, int, System.ValueTuple<int, int, int>> ten = big;
      }
    }
    `,
  ),
  diag(
    'language-version-7-0',
    cs`
    class Program {
      static void Main() {
        int x = 8, y = 9;
        var big = (1, 2, 3, 4, 5, 6, 7, x, y);
        System.Console.WriteLine(big.y);
        System.Console.WriteLine(big.Item9);
        System.Console.WriteLine(big == big);
      }
    }
    `,
    { langVersion: '7' },
  ),
];

export const fixtures = feature('tuple-wide', list);
