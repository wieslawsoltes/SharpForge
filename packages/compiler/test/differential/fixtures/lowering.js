/**
 * Differential fixtures for SF-A02-E02 (lowering): delegates, closures, local functions, events, patterns and member
 * initialization. Every program here is outside the string-typed execution profile, so its image comes from the
 * semantic code generator; the pinned output is what the same program prints on .NET.
 */
import { cs, out, feature } from './kit.js';

export const fixtures = [
  ...feature('delegates', [
    out(
      'declared-delegate-and-method-groups',
      cs`
    using System;
    delegate int Op(int a, int b);
    class Calculator
    {
        int bias;
        public Calculator(int bias) { this.bias = bias; }
        public int AddBiased(int a, int b) { return a + b + bias; }
        public static int Multiply(int a, int b) { return a * b; }
    }
    class Program
    {
        static int Apply(Op op, int a, int b) { return op(a, b); }
        static void Main()
        {
            Op multiply = Calculator.Multiply;
            var calculator = new Calculator(100);
            Op add = calculator.AddBiased;
            Console.WriteLine(Apply(multiply, 6, 7));
            Console.WriteLine(Apply(add, 1, 2));
            Op viaNew = new Op(Calculator.Multiply);
            Console.WriteLine(viaNew(2, 5));
        }
    }
  `,
    ),
    out(
      'multicast-order-and-result',
      cs`
    using System;
    delegate int Step(int x);
    class Program
    {
        static int log;
        static int First(int x) { log = log * 10 + 1; return x + 1; }
        static int Second(int x) { log = log * 10 + 2; return x + 2; }
        static int Third(int x) { log = log * 10 + 3; return x + 3; }
        static void Main()
        {
            Step chain = First;
            chain += Second;
            chain += Third;
            Console.WriteLine(chain(10));
            Console.WriteLine(log);
            log = 0;
            Step both = chain + chain;
            Console.WriteLine(both(0));
            Console.WriteLine(log);
        }
    }
  `,
    ),
    out(
      'removal-identity',
      cs`
    using System;
    delegate void Note();
    class Program
    {
        static int log;
        static void A() { log = log * 10 + 1; }
        static void B() { log = log * 10 + 2; }
        static void C() { log = log * 10 + 3; }
        static void Run(Note note) { log = 0; if (note != null) note(); Console.WriteLine(log); }
        static void Main()
        {
            Note a = A, b = B, c = C;
            Note all = a + b + a + c;
            Run(all);
            Run(all - a);
            Run(all - b);
            Run(all - (b + a));
            Run(all - (a + c));
            Run(all - (c + a));
            Note none = a - a;
            Console.WriteLine(none == null);
            Note same = all - all;
            Console.WriteLine(same == null);
        }
    }
  `,
    ),
    out(
      'func-and-action-arities',
      cs`
    using System;
    class Program
    {
        static int total;
        static void Main()
        {
            Func<int> zero = () => 7;
            Func<int, int> one = x => x * x;
            Func<int, int, int> two = (a, b) => a - b;
            Func<int, string, bool, string> three = (n, s, b) => s + n + b;
            Action none = () => total += 1;
            Action<int> add = n => total += n;
            Action<int, int> addBoth = (a, b) => total += a * b;
            none(); add(10); addBoth(3, 4);
            Console.WriteLine(zero() + one(5) + two(9, 4));
            Console.WriteLine(three(1, "x", true));
            Console.WriteLine(total);
            Func<Func<int, int>, int, int> twice = (f, x) => f(f(x));
            Console.WriteLine(twice(one, 3));
        }
    }
  `,
    ),
  ]),
  ...feature('closures', [
    out(
      'loop-capture-lifetimes',
      cs`
    using System;
    class Program
    {
        static void Main()
        {
            Func<int>[] perIteration = new Func<int>[3];
            Func<int>[] shared = new Func<int>[3];
            int[] values = { 10, 20, 30 };
            int slot = 0;
            foreach (int value in values) { perIteration[slot] = () => value; slot++; }
            for (int i = 0; i < 3; i++) { shared[i] = () => i; }
            foreach (Func<int> f in perIteration) Console.WriteLine(f());
            foreach (Func<int> f in shared) Console.WriteLine(f());
            Func<int>[] copies = new Func<int>[3];
            for (int i = 0; i < 3; i++) { int copy = i * 2; copies[i] = () => copy; }
            foreach (Func<int> f in copies) Console.WriteLine(f());
        }
    }
  `,
    ),
    out(
      'shared-mutable-state',
      cs`
    using System;
    class Program
    {
        static Func<int> MakeCounter(int start, int step)
        {
            int current = start;
            return () => { current += step; return current; };
        }
        static void Main()
        {
            int counter = 0;
            Action bump = () => counter++;
            Func<int> read = () => counter;
            bump(); bump();
            counter += 10;
            Console.WriteLine(read());
            Func<int> a = MakeCounter(0, 1), b = MakeCounter(100, 10);
            a(); a();
            Console.WriteLine(a() + " " + b());
            Func<int, Func<int, Func<int, int>>> curried = x => y => z => x * 100 + y * 10 + z;
            Console.WriteLine(curried(1)(2)(3));
        }
    }
  `,
    ),
    out(
      'captured-this-and-parameters',
      cs`
    using System;
    class Account
    {
        int balance;
        public Account(int balance) { this.balance = balance; }
        public Func<int, int> Depositor() { return amount => { balance += amount; return balance; }; }
        public Action<int> Scaled(int factor)
        {
            factor = factor * 2;
            return amount => balance += amount * factor;
        }
        public int Balance { get { return balance; } }
    }
    class Program
    {
        static void Main()
        {
            var account = new Account(100);
            var deposit = account.Depositor();
            deposit(5);
            Console.WriteLine(deposit(5));
            account.Scaled(3)(10);
            Console.WriteLine(account.Balance);
        }
    }
  `,
    ),
    out(
      'local-functions',
      cs`
    using System;
    class Program
    {
        static int Factorial(int n)
        {
            return Go(n, 1);
            int Go(int k, int acc) { return k <= 1 ? acc : Go(k - 1, acc * k); }
        }
        static void Main()
        {
            int calls = 0;
            int Fib(int n) { calls++; return n < 2 ? n : Fib(n - 1) + Fib(n - 2); }
            Console.WriteLine(Fib(10) + " " + calls);
            Console.WriteLine(Factorial(6));
            int offset = 5;
            int Shift(int x) => x + offset;
            offset = 50;
            Console.WriteLine(Shift(1));
            Func<int, int> asDelegate = Shift;
            offset = 500;
            Console.WriteLine(asDelegate(1));
            int Outer(int x)
            {
                int Inner(int y) => y * offset + x;
                return Inner(2);
            }
            Console.WriteLine(Outer(3));
            static int Square(int x) => x * x;
            Console.WriteLine(Square(9));
        }
    }
  `,
    ),
  ]),
  ...feature('events', [
    out(
      'field-like-events',
      cs`
    using System;
    delegate void Changed(string name, int value);
    class Model
    {
        int value;
        public event Changed OnChanged;
        public void Set(int next) { value = next; if (OnChanged != null) OnChanged("value", value); }
        public void SetQuietly(int next) { value = next; OnChanged?.Invoke("quiet", value); }
    }
    class Program
    {
        static void Print(string name, int value) { Console.WriteLine(name + "=" + value); }
        static void Main()
        {
            var model = new Model();
            model.Set(1);
            int seen = 0;
            Changed count = (name, value) => seen += value;
            model.OnChanged += Print;
            model.OnChanged += count;
            model.Set(2);
            model.OnChanged -= Print;
            model.SetQuietly(3);
            model.OnChanged -= count;
            model.Set(4);
            Console.WriteLine(seen);
        }
    }
  `,
    ),
    out(
      'event-accessors',
      cs`
    using System;
    delegate void Tick();
    class Clock
    {
        Tick handlers;
        int subscriptions;
        public event Tick Ticked
        {
            add { subscriptions++; handlers += value; }
            remove { subscriptions--; handlers -= value; }
        }
        public void Run() { if (handlers != null) handlers(); Console.WriteLine(subscriptions); }
    }
    class Program
    {
        static void Main()
        {
            var clock = new Clock();
            Tick tick = () => Console.WriteLine("tick");
            clock.Ticked += tick;
            clock.Ticked += tick;
            clock.Run();
            clock.Ticked -= tick;
            clock.Run();
        }
    }
  `,
    ),
  ]),
  ...feature('patterns', [
    out(
      'constant-relational-logical',
      cs`
    using System;
    class Program
    {
        static string Describe(int n)
        {
            if (n is 0) return "zero";
            if (n is < 0) return "negative";
            if (n is >= 1 and <= 9) return "digit";
            if (n is 10 or 100 or 1000) return "power";
            if (n is not (> 10 and < 100)) return "large";
            return "other";
        }
        static void Main()
        {
            Console.WriteLine(Describe(0) + Describe(-5) + Describe(7) + Describe(100) + Describe(55) + Describe(5000));
            string s = null;
            Console.WriteLine(s is null);
            s = "text";
            Console.WriteLine(s is not null);
            Console.WriteLine(s is "text" or "other");
            if (s is var copy && copy.Length is var length and > 3) Console.WriteLine(copy + length);
        }
    }
  `,
    ),
    out(
      'switch-expression-shared-evaluation',
      cs`
    using System;
    class Point
    {
        public static int Reads;
        int x, y;
        public Point(int x, int y) { this.x = x; this.y = y; }
        public int X { get { Reads++; return x; } }
        public int Y { get { Reads++; return y; } }
    }
    class Program
    {
        static string Where(Point p) => p switch
        {
            { X: 0, Y: 0 } => "origin",
            { X: 0 } => "y-axis",
            { Y: 0 } => "x-axis",
            { X: > 0, Y: > 0 } => "first quadrant",
            _ => "elsewhere",
        };
        static void Main()
        {
            Console.WriteLine(Where(new Point(0, 0)) + " " + Point.Reads);
            Point.Reads = 0;
            Console.WriteLine(Where(new Point(0, 5)) + " " + Point.Reads);
            Point.Reads = 0;
            Console.WriteLine(Where(new Point(5, 0)) + " " + Point.Reads);
            Point.Reads = 0;
            Console.WriteLine(Where(new Point(2, 3)) + " " + Point.Reads);
            Point.Reads = 0;
            Console.WriteLine(Where(new Point(-2, 3)) + " " + Point.Reads);
        }
    }
  `,
    ),
    out(
      'switch-statement-patterns-and-when',
      cs`
    using System;
    class Program
    {
        static int evaluations;
        static int Next() { evaluations++; return 42; }
        static string Classify(int n, bool strict)
        {
            switch (n)
            {
                case < 0:
                    return "negative";
                case 0:
                case 1:
                    return "small";
                case > 100 when strict:
                    return "too large";
                case var other when other % 2 == 0:
                    return "even " + other;
                default:
                    return "odd";
            }
        }
        static void Main()
        {
            Console.WriteLine(Classify(-1, false) + "," + Classify(1, false) + "," + Classify(500, true));
            Console.WriteLine(Classify(500, false) + "," + Classify(7, false));
            switch (Next())
            {
                case 1: Console.WriteLine("one"); break;
                case 42: Console.WriteLine("answer"); break;
                default: Console.WriteLine("other"); break;
            }
            Console.WriteLine(evaluations);
            string text = "b";
            switch (text)
            {
                case "a": Console.WriteLine("first"); break;
                case "b":
                case "c": Console.WriteLine("second or third"); break;
            }
        }
    }
  `,
    ),
  ]),
  ...feature('iterators', [
    out(
      'yield-in-loops-and-branches',
      cs`
    using System;
    using System.Collections.Generic;
    class Program
    {
        static IEnumerable<int> Range(int start, int count)
        {
            for (int i = 0; i < count; i++)
            {
                if (i == 3) yield break;
                yield return start + i;
            }
        }
        static IEnumerable<string> Words(bool shout)
        {
            string suffix = shout ? "!" : ".";
            yield return "one" + suffix;
            int n = 2;
            while (n < 4) { yield return "n" + n + suffix; n++; }
            switch (n) { case 4: yield return "four"; break; default: yield return "other"; break; }
            foreach (int nested in Range(10, 2)) yield return "r" + nested;
            int[] tail = { 7, 8 };
            foreach (int t in tail) { if (t == 8) continue; yield return "t" + t; }
        }
        static void Main()
        {
            foreach (int x in Range(5, 10)) Console.WriteLine(x);
            foreach (string w in Words(true)) Console.WriteLine(w);
            foreach (int unused in Range(0, 0)) Console.WriteLine("never");
            Console.WriteLine("done");
        }
    }
  `,
    ),
    out(
      'laziness-and-re-enumeration',
      cs`
    using System;
    using System.Collections.Generic;
    class Source
    {
        int[] items = { 3, 1, 2 };
        public int Scale = 10;
        public IEnumerable<int> Scaled()
        {
            Console.WriteLine("start");
            foreach (int item in items) yield return item * Scale;
            Console.WriteLine("end");
        }
    }
    class Program
    {
        static IEnumerable<int> Counter(int limit)
        {
            while (limit > 0) { yield return limit; limit--; }
        }
        static void Main()
        {
            var source = new Source();
            IEnumerable<int> scaled = source.Scaled();
            Console.WriteLine("created");
            source.Scale = 100;
            foreach (int s in scaled) Console.WriteLine(s);
            IEnumerable<int> counter = Counter(2);
            foreach (int c in counter) Console.WriteLine(c);
            foreach (int c in counter) Console.WriteLine(c);
            IEnumerator<int> manual = Counter(3).GetEnumerator();
            manual.MoveNext();
            manual.MoveNext();
            Console.WriteLine(manual.Current);
            Console.WriteLine(manual.MoveNext());
            Console.WriteLine(manual.MoveNext());
            Console.WriteLine(manual.MoveNext());
            manual.Dispose();
        }
    }
  `,
    ),
    out(
      'iterators-with-closures-and-local-functions',
      cs`
    using System;
    using System.Collections.Generic;
    class Program
    {
        static IEnumerable<Func<int>> Makers(int count)
        {
            for (int i = 0; i < count; i++)
            {
                int captured = i * i;
                yield return () => captured + count;
            }
        }
        static IEnumerable<int> Evens(int limit)
        {
            bool IsEven(int n) => n % 2 == 0;
            for (int i = 0; i <= limit; i++) if (IsEven(i)) yield return i;
        }
        static IEnumerator<int> Pair(int a, int b) { yield return a; yield return b; }
        static void Main()
        {
            foreach (Func<int> make in Makers(3)) Console.WriteLine(make());
            int sum = 0;
            foreach (int e in Evens(6)) sum += e;
            Console.WriteLine(sum);
            IEnumerator<int> pair = Pair(1, 2);
            while (pair.MoveNext()) Console.WriteLine(pair.Current);
        }
    }
  `,
    ),
  ]),
  ...feature('initialization', [
    out(
      'order-of-initializers-and-constructors',
      cs`
    using System;
    class Tracker
    {
        public static int Sequence;
        public static int Next(string label) { Sequence++; Console.WriteLine(Sequence + ":" + label); return Sequence; }
    }
    class Widget
    {
        static int shared = Tracker.Next("static field");
        int first = Tracker.Next("first field");
        public int Auto { get; set; } = Tracker.Next("auto property");
        int last = Tracker.Next("last field");
        public const int Limit = 3;
        readonly int id;
        public Widget() : this(Tracker.Next("chained argument")) { Tracker.Next("parameterless body"); }
        public Widget(int id) { this.id = id; Tracker.Next("body " + id); }
        public int Id { get { return id; } }
        public int Sum => first + Auto + last + shared;
    }
    class Program
    {
        static void Main()
        {
            var w = new Widget { Auto = Tracker.Next("initializer") };
            Console.WriteLine(w.Id + " " + w.Auto + " " + Widget.Limit);
            var second = new Widget(99);
            Console.WriteLine(second.Sum);
        }
    }
  `,
    ),
    out(
      'properties-indexers-and-statics',
      cs`
    using System;
    class Grid
    {
        int[] cells;
        int width;
        public static int Created { get; private set; }
        public Grid(int width, int height) { this.width = width; cells = new int[width * height]; Created++; }
        public int this[int x, int y]
        {
            get { return cells[y * width + x]; }
            set { cells[y * width + x] = value; }
        }
        public int Count { get { return cells.Length; } }
        public string Name { get; set; } = "grid";
        public bool IsEmpty => Count == 0;
    }
    class Program
    {
        static void Main()
        {
            var grid = new Grid(3, 2) { Name = "board" };
            grid[1, 1] = 5;
            grid[2, 0] = grid[1, 1] + 1;
            Console.WriteLine(grid[1, 1] + grid[2, 0] + grid[0, 0]);
            Console.WriteLine(grid.Name + grid.Count + grid.IsEmpty);
            var other = new Grid(0, 0);
            Console.WriteLine(Grid.Created + " " + other.IsEmpty);
            grid.Name += "!";
            Console.WriteLine(grid.Name);
        }
    }
  `,
    ),
    out(
      'optional-named-and-params-arguments',
      cs`
    using System;
    class Program
    {
        static int trace;
        static int Mark(int digit, int value) { trace = trace * 10 + digit; return value; }
        static string Join(string separator, params int[] values)
        {
            string text = "";
            for (int i = 0; i < values.Length; i++) text += (i > 0 ? separator : "") + values[i];
            return text;
        }
        static int Weighted(int a, int b = 10, int c = 100) { return a + b * 2 + c * 3; }
        static void Main()
        {
            Console.WriteLine(Join("-"));
            Console.WriteLine(Join("-", 1));
            Console.WriteLine(Join("+", 1, 2, 3));
            Console.WriteLine(Weighted(1));
            Console.WriteLine(Weighted(1, c: 2));
            Console.WriteLine(Weighted(c: Mark(1, 1), a: Mark(2, 2), b: Mark(3, 3)));
            Console.WriteLine(trace);
        }
    }
  `,
    ),
  ]),
];
