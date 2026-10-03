/**
 * Differential fixtures for SF-A02-T08.6 (synthesized record members) and SF-A02-T08.7 (`with`). The output
 * programs run from the semantic code generator; the pinned output is what the same program prints on .NET.
 */
import { cs, out, diag, feature } from './kit.js';

export const fixtures = [
  ...feature('record-lowering', [
    out(
      'positional-record-equality-text-and-deconstruction',
      cs`
    using System;
    record Point(int X, int Y);
    record Empty;
    class Program
    {
        static void Main()
        {
            var p = new Point(1, 2);
            var q = new Point(1, 2);
            var r = new Point(2, 1);
            Console.WriteLine(p == q);
            Console.WriteLine(p != q);
            Console.WriteLine(p.Equals(q));
            Console.WriteLine(p == r);
            Console.WriteLine(p);
            Console.WriteLine(p.ToString());
            Console.WriteLine("p=" + p + $" [{r}]");
            Console.WriteLine(p.X + p.Y);
            var (x, y) = r;
            Console.WriteLine(x * 10 + y);
            Point none = null;
            Console.WriteLine(none == p);
            Console.WriteLine(none == null);
            Console.WriteLine(p != null);
            Console.WriteLine(p.GetHashCode() == q.GetHashCode());
            Console.WriteLine(new Empty());
            Console.WriteLine(new Empty() == new Empty());
            Console.WriteLine("[" + none + "]");
        }
    }
  `,
    ),
    out(
      'members-of-every-kind',
      cs`
    using System;
    class Tag { public string Text = "t"; }
    record Person(string Name, int Age)
    {
        public string Nick { get; init; }
        public int Visits;
        public double Score { get; set; }
        private int secret = 7;
        public static int Created;
        public int Secret() { return secret; }
        public bool Adult { get { return Age >= 18; } }
    }
    record Line(Person Owner, (int, string) Mark, bool Closed);
    record Holder(Tag Tag);
    class Program
    {
        static void Main()
        {
            var ann = new Person("Ann", 30) { Nick = "A", Score = 1.5 };
            ann.Visits = 3;
            Console.WriteLine(ann);
            var twin = new Person("Ann", 30) { Nick = "A", Score = 1.5 };
            Console.WriteLine(ann == twin);
            twin.Visits = 3;
            Console.WriteLine(ann == twin);
            Console.WriteLine(ann.Secret());
            var line = new Line(ann, (1, "m"), true);
            Console.WriteLine(line);
            Console.WriteLine(line == new Line(twin, (1, "m"), true));
            Console.WriteLine(line == new Line(null, (1, "m"), true));
            Console.WriteLine(new Line(null, (0, null), false));
            var tag = new Tag();
            Console.WriteLine(new Holder(tag) == new Holder(tag));
            Console.WriteLine(new Holder(tag) == new Holder(new Tag()));
            double nan = 0.0;
            nan = nan / nan;
            var a = new Person("n", 1) { Score = nan };
            var b = new Person("n", 1) { Score = nan };
            Console.WriteLine(a == b);
        }
    }
  `,
    ),
    out(
      'declared-members-replace-synthesized-ones',
      cs`
    using System;
    record Temperature(double Degrees)
    {
        public override string ToString() { return Degrees + " C"; }
    }
    record Money(int Cents)
    {
        public virtual bool Equals(Money other) { return other != null && Cents / 100 == other.Cents / 100; }
        public override int GetHashCode() { return Cents / 100; }
        public void Deconstruct(out int whole, out int rest) { whole = Cents / 100; rest = Cents % 100; }
    }
    class Program
    {
        static void Main()
        {
            var t = new Temperature(21.5);
            Console.WriteLine(t);
            Console.WriteLine("it is " + t);
            Console.WriteLine(t.ToString());
            Console.WriteLine(new Money(150) == new Money(199));
            Console.WriteLine(new Money(150) != new Money(200));
            Console.WriteLine(new Money(150).GetHashCode());
            var (whole, rest) = new Money(250);
            Console.WriteLine(whole + "." + rest);
            Console.WriteLine(new Money(5));
        }
    }
  `,
    ),
    out(
      'with-copies-and-assigns',
      cs`
    using System;
    record Point(int X, int Y);
    record Person(string Name, Point Home)
    {
        public string Nick { get; init; }
        public int Visits;
    }
    class Program
    {
        static int evaluations;
        static Person Source(Person p) { evaluations++; return p; }
        static int Next(int n) { Console.WriteLine("value " + n); return n; }
        static void Main()
        {
            var p = new Point(1, 2);
            var moved = p with { X = 5 };
            Console.WriteLine(moved + " " + p);
            var swapped = p with { Y = Next(1), X = Next(2) };
            Console.WriteLine(swapped);
            var ann = new Person("Ann", p) { Nick = "A" };
            var copy = Source(ann) with { };
            Console.WriteLine(copy == ann);
            Console.WriteLine(evaluations);
            var bob = ann with { Name = "Bob", Visits = 4, Home = p with { Y = 9 } };
            Console.WriteLine(bob);
            Console.WriteLine(ann);
            Console.WriteLine(bob.Home == ann.Home);
            Console.WriteLine((ann with { Nick = "A" }) == ann);
        }
    }
  `,
    ),
    diag(
      'with-errors',
      cs`
    class Plain { public int X; }
    record Point(int X, int Y);
    class Program
    {
        static void Main()
        {
            var plain = new Plain();
            plain.X = 2;
            var a = plain with { X = 1 };
            var p = new Point(1, 2);
            var b = p with { Z = 1 };
            var c = p with { X = "s" };
            var d = 5 with { };
            p.X = 3;
            System.Console.WriteLine(p);
        }
    }
  `,
    ),
    diag(
      'synthesized-member-use',
      cs`
    record Point(int X, int Y);
    class Program
    {
        static void Main()
        {
            var p = new Point(1, 2);
            var (a, b, c) = p;
            int n = p == new Point(3, 4);
            string s = p.Equals(p);
            var q = new Point(1);
            System.Console.WriteLine(p.Z);
        }
    }
  `,
    ),
    diag(
      'record-struct-members-bind',
      cs`
    record struct Size(int Width, int Height);
    readonly record struct Fixed(int Value);
    class Program
    {
        static void Main()
        {
            var a = new Size(1, 2);
            a.Width = 3;
            var (w, h) = a;
            bool same = a == new Size(3, 2);
            string text = a.ToString();
            int wrong = a.Equals(a);
            var (p, q, r) = a;
            var f = new Fixed(1);
            f.Value = 2;
            Size none = null;
            var b = a with { Height = "tall" };
            System.Console.WriteLine(w + h + text + same + f.Value + b.Width);
        }
    }
  `,
    ),
  ]),
];
