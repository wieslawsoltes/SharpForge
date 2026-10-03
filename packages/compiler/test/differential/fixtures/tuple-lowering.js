/**
 * Differential fixtures for SF-A02-T08.4 (tuples): tuple types and literals, element names, value semantics,
 * conversions, equality and text. Tuples are outside the string-typed execution profile, so every output program
 * here runs from the semantic code generator; the pinned output is what the same program prints on .NET.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('tuple-lowering', [
    out(
      'literals-elements-and-names',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            var plain = (1, "x");
            Console.WriteLine(plain.Item1);
            Console.WriteLine(plain.Item2);
            (int id, string name) named = (2, "y");
            Console.WriteLine(named.id + named.name);
            Console.WriteLine(named.Item1 + named.Item2);
            var literal = (count: 3, label: "z");
            Console.WriteLine(literal.label + literal.count);
            int width = 4, height = 5;
            var inferred = (width, height);
            Console.WriteLine(inferred.width * inferred.height);
            var seven = (1, 2, 3, 4, 5, 6, 7);
            Console.WriteLine(seven.Item7 + seven.Item1);
        }
    }
  `,
    ),
    out(
      'value-semantics-on-copy-and-element-store',
      cs`
    using System;
    class Program
    {
        static (int, int) Swap((int, int) p) { p.Item1 += 10; return (p.Item2, p.Item1); }
        static void Main()
        {
            var a = (x: 1, y: 2);
            var b = a;
            b.x = 10;
            b.y++;
            ++b.y;
            b.x *= 3;
            Console.WriteLine(a);
            Console.WriteLine(b);
            Console.WriteLine(b.y++);
            Console.WriteLine(b.y);
            var swapped = Swap(a);
            Console.WriteLine(a);
            Console.WriteLine(swapped);
            Func<(int, int)> make = () => (a.x + 1, a.y + 1);
            a.x = 100;
            Console.WriteLine(make());
            (int p, string q) parts;
            parts.p = 1;
            parts.q = "q";
            Console.WriteLine(parts);
        }
    }
  `,
    ),
    out(
      'tuples-in-fields-arrays-and-properties',
      cs`
    using System;
    class Holder
    {
        public (int x, int y) Point;
        public (string name, (int a, int b) inner)[] Items = new (string, (int, int))[2];
        public (int, int) Auto { get; set; }
        public static (int, string) Shared;
    }
    class Program
    {
        static int calls;
        static int Next() { calls++; return 1; }
        static void Main()
        {
            var h = new Holder();
            Console.WriteLine(h.Point);
            h.Point.x = 4;
            h.Point.y += 5;
            Console.WriteLine(h.Point);
            Console.WriteLine(h.Items[1].inner);
            h.Items[Next()].inner.b = 9;
            h.Items[0].name = "n";
            Console.WriteLine(h.Items[1]);
            Console.WriteLine(h.Items[0]);
            Console.WriteLine(calls);
            Console.WriteLine(h.Auto);
            h.Auto = (7, 8);
            Console.WriteLine(h.Auto.Item2);
            Holder.Shared.Item2 = "s";
            Holder.Shared.Item1--;
            Console.WriteLine(Holder.Shared);
        }
    }
  `,
    ),
    out(
      'returns-parameters-and-nesting',
      cs`
    using System;
    class Program
    {
        static (int sum, int count) Tally(int[] values)
        {
            int sum = 0;
            foreach (var value in values) sum += value;
            return (sum, values.Length);
        }
        static ((int, string) head, double tail) Nest(int n) { return ((n, "n" + n), n / 2.0); }
        static int Total((int a, int b) pair, (int, (int, int)) deep) { return pair.a + pair.b + deep.Item1 + deep.Item2.Item1 + deep.Item2.Item2; }
        static void Main()
        {
            var result = Tally(new[] { 1, 2, 3 });
            Console.WriteLine(result.sum + " " + result.count);
            Console.WriteLine(Tally(new int[0]).count);
            var nested = Nest(3);
            Console.WriteLine(nested.head.Item2 + nested.tail);
            Console.WriteLine(Total((1, 2), (3, (4, 5))));
        }
    }
  `,
    ),
    out(
      'equality-conversions-and-default',
      cs`
    using System;
    class Program
    {
        static int evaluations;
        static (int, string) Make(int n) { evaluations++; return (n, "v"); }
        static int Id(int n) { Console.Write(n); return n; }
        static void Main()
        {
            var a = (1, "v");
            Console.WriteLine(a == Make(1));
            Console.WriteLine(a != Make(1));
            Console.WriteLine(a == Make(2));
            Console.WriteLine(evaluations);
            var nested = ((1, "a"), 2.5);
            var same = ((1, "a"), 2.5);
            var other = ((1, "b"), 2.5);
            Console.WriteLine(nested == same);
            Console.WriteLine(nested == other);
            Console.WriteLine(nested != other);
            double nan = 0.0;
            nan = nan / nan;
            Console.WriteLine((nan, 1) == (nan, 1));
            Console.WriteLine((Id(1), Id(2)) == (Id(3), Id(4)));
            Console.WriteLine((Id(1), (Id(2), Id(3))) != (Id(1), (Id(2), Id(4))));
            Console.WriteLine((1, "a") == (1, null));
            Console.WriteLine((1, (string)null) == (1, null));
            Console.WriteLine(nested == (a, 2.5));
            Console.WriteLine((a, 1) == (Make(1), 1));
            Console.WriteLine((1, 2) == (1.0, 2.0));
            (double, double) widened = (1, 2);
            Console.WriteLine(widened.Item1 / widened.Item2);
            (int x, int y) ints = (3, 4);
            (double, double) converted = ints;
            Console.WriteLine(converted.Item1 / converted.Item2);
            (int, string) zero = default;
            Console.WriteLine(zero.Item1);
            Console.WriteLine(zero.Item2 == null);
            (int first, int second) renamed = ints;
            Console.WriteLine(renamed.second);
        }
    }
  `,
    ),
    out(
      'text-of-tuples',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            var t = (1, 2.5, true, "s");
            Console.WriteLine(t);
            Console.WriteLine(t.ToString());
            Console.WriteLine("t=" + t);
            Console.WriteLine(t + "!");
            Console.WriteLine($"[{t}] [{(1, 2),10}]");
            Console.Write((1, (string)null));
            Console.WriteLine();
            Console.WriteLine(((1, 2), (3, (4, 5))));
        }
    }
  `,
    ),
    diag(
      'element-name-rules',
      cs`
    class Program
    {
        static void Main()
        {
            var a = (Item2: 1, Rest: 2, x: 3, x: 4);
            (int Item2, int ToString) b = (1, 2);
            (int c, int c) d = (1, 2);
            var e = (Item1: 1, Item2: 2);
            System.Console.WriteLine(a.x + b.Item1 + d.Item1 + e.Item1);
        }
    }
  `,
    ),
    diag(
      'equality-operand-errors',
      cs`
    class Program
    {
        static void Main()
        {
            var a = (1, 2);
            System.Console.WriteLine(a == (1, 2, 3));
            System.Console.WriteLine(a == (1, "x"));
            System.Console.WriteLine((1, 2) != (1, (2, 3)));
        }
    }
  `,
    ),
    diag(
      'equality-needs-7-3',
      cs`
    class Program
    {
        static void Main()
        {
            System.Console.WriteLine((1, 2) == (1, 2));
        }
    }
  `,
      { langVersion: '7.2' },
    ),
    diag(
      'inferred-names-need-7-1',
      cs`
    class Program
    {
        static void Main()
        {
            int a = 1, b = 2;
            var t = (a, b);
            System.Console.WriteLine(t.a + t.Item2);
        }
    }
  `,
      { langVersion: '7.0' },
    ),
    diag(
      'element-access-and-assignment-errors',
      cs`
    class Program
    {
        static (int, int) Make() { return (1, 2); }
        static void Main()
        {
            var t = (a: 1, b: 2);
            System.Console.WriteLine(t.c);
            System.Console.WriteLine(t.Item3);
            Make().Item1 = 5;
            (int, string) u = (1, 2);
            (int x, int y) v;
            v.x = 1;
            System.Console.WriteLine(v.y);
        }
    }
  `,
    ),
  ]),
];
