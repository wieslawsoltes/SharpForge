/**
 * Differential fixtures for SF-A02-T10.6: object, collection, nested and index initializers. Output fixtures pin the
 * evaluation order .NET uses; diagnostics fixtures pin what Roslyn reports for initializers that are not valid.
 */
import { cs, out, diag, feature } from './kit.js';

const outputs = [
  out(
    'framework-collections',
    cs`
    using System;
    using System.Collections.Generic;
    class Program
    {
        static void Main()
        {
            var list = new List<int> { 1, 2, 3 };
            var names = new List<string> { "a", "b" };
            var map = new Dictionary<string, int> { { "one", 1 }, { "two", 2 } };
            var indexed = new Dictionary<string, int> { ["x"] = 10, ["y"] = 20, ["x"] = 30 };
            Console.WriteLine(list.Count + " " + list[2]);
            Console.WriteLine(names[0] + names[1]);
            Console.WriteLine(map["one"] + map["two"]);
            Console.WriteLine(indexed.Count + " " + indexed["x"]);
        }
    }
  `,
  ),
  out(
    'evaluation-order',
    cs`
    using System;
    class Target
    {
        int[] slots = new int[4];
        public Target(int seed) { Console.WriteLine("ctor " + seed); }
        public int A { set { Console.WriteLine("set A " + value); } }
        public int B;
        public int this[int i] { get { return slots[i]; } set { Console.WriteLine("set [" + i + "] " + value); slots[i] = value; } }
    }
    class Program
    {
        static int Log(string what, int value) { Console.WriteLine(what); return value; }
        static void Main()
        {
            var t = new Target(Log("argument", 1)) { A = Log("value A", 2), [Log("index", 3)] = Log("value index", 4), B = Log("value B", 5) };
            Console.WriteLine(t.B + t[3]);
        }
    }
  `,
  ),
  out(
    'nested-object-initializer-reads-the-member-each-time',
    cs`
    using System;
    class Point { public int X; public int Y { get; set; } }
    class Line
    {
        Point start = new Point();
        public int Reads;
        public Point Start { get { Reads++; return start; } }
        public Point End = new Point();
    }
    class Program
    {
        static void Main()
        {
            var line = new Line { Start = { X = 1, Y = 2 }, End = { X = 3 } };
            Console.WriteLine(line.Reads);
            Console.WriteLine(line.Start.X + " " + line.Start.Y + " " + line.End.X + " " + line.End.Y);
            var empty = new Line { Start = { } };
            Console.WriteLine(empty.Reads);
        }
    }
  `,
  ),
  out(
    'nested-collection-initializer',
    cs`
    using System;
    using System.Collections.Generic;
    class Basket
    {
        List<string> items = new List<string>();
        public int Reads;
        public List<string> Items { get { Reads++; return items; } }
        public Dictionary<string, int> Prices { get; } = new Dictionary<string, int>();
    }
    class Program
    {
        static void Main()
        {
            var basket = new Basket { Items = { "apple", "pear", "plum" }, Prices = { { "apple", 3 }, { "pear", 4 } } };
            Console.WriteLine(basket.Reads);
            Console.WriteLine(basket.Items.Count + basket.Items[2]);
            Console.WriteLine(basket.Prices["apple"] + basket.Prices["pear"]);
        }
    }
  `,
  ),
  out(
    'index-initializers-on-arrays-and-indexers',
    cs`
    using System;
    class Grid
    {
        int[] cells = new int[9];
        public int[] Row = new int[3];
        public int this[int i] { get { return cells[i]; } set { cells[i] = value; } }
        public int this[int r, int c] { get { return cells[r * 3 + c]; } set { cells[r * 3 + c] = value; } }
        public string this[string key] { get { return key + "!"; } }
    }
    class Holder { public Grid Grid = new Grid(); public Grid[] Grids = new Grid[2]; }
    class Program
    {
        static int calls;
        static int Next() { return calls++; }
        static void Main()
        {
            var g = new Grid { [0] = 4, [1, 1] = 6, Row = { [0] = 7, [2] = 9 } };
            Console.WriteLine(g[0] + " " + g[4] + " " + g[1, 1] + " " + g.Row[0] + g.Row[1] + g.Row[2] + " " + g["k"]);
            var h = new Holder { Grid = { [Next()] = 10, [Next()] = 11 }, Grids = { [0] = new Grid { [8] = 5 } } };
            Console.WriteLine(h.Grid[0] + " " + h.Grid[1] + " " + calls + " " + h.Grids[0][8]);
        }
    }
  `,
  ),
  out(
    'index-initializer-with-nested-initializer',
    cs`
    using System;
    class Cell { public int Value; public string Tag; }
    class Board
    {
        Cell[] cells = new Cell[] { new Cell(), new Cell(), new Cell() };
        public int Reads;
        public Cell this[int i] { get { Reads++; return cells[i]; } }
    }
    class Program
    {
        static int Log(int value) { Console.WriteLine("index " + value); return value; }
        static void Main()
        {
            var board = new Board { [Log(1)] = { Value = 5, Tag = "five" }, [Log(2)] = { Value = 7 } };
            Console.WriteLine(board.Reads);
            Console.WriteLine(board[1].Value + board[1].Tag + board[2].Value);
        }
    }
  `,
  ),
  out(
    'user-collection-add-overloads',
    cs`
    using System;
    using System.Collections;
    class Bag : IEnumerable
    {
        int total;
        string log = "";
        public void Add(int value) { total += value; log += "i"; }
        public void Add(string text) { total += text.Length; log += "s"; }
        public void Add(string text, int times) { total += text.Length * times; log += "p"; }
        public void Add(int first, int second, int third = 100) { total += first + second + third; log += "t"; }
        public int Total { get { return total; } }
        public string Log { get { return log; } }
        public IEnumerator GetEnumerator() { return null; }
    }
    class Program
    {
        static void Main()
        {
            var bag = new Bag { 1, "four", { "ab", 5 }, { 1, 2 }, 2 + 3 };
            Console.WriteLine(bag.Total);
            Console.WriteLine(bag.Log);
        }
    }
  `,
  ),
  out(
    'extension-add',
    cs`
    using System;
    using System.Collections.Generic;
    static class Extensions
    {
        public static void Add(this List<int> numbers, string text) { numbers.Add(text.Length); }
        public static void Add(this List<string> words, string first, string second) { words.Add(first + second); }
    }
    class Program
    {
        static void Main()
        {
            var numbers = new List<int> { 1, "three", 2 };
            var words = new List<string> { "a", { "b", "c" }, "d" };
            Console.WriteLine(numbers[0] + numbers[1] + numbers[2]);
            Console.WriteLine(words.Count + words[1]);
        }
    }
  `,
  ),
  out(
    'initializers-in-fields-lambdas-and-arguments',
    cs`
    using System;
    using System.Collections.Generic;
    class Options { public int Size { get; set; } public string Name = "none"; public List<int> Marks { get; } = new List<int>(); }
    class Program
    {
        static Options defaults = new Options { Size = 3, Marks = { 1, 2 } };
        static int Describe(Options o) { return o.Size * 10 + o.Marks.Count; }
        static void Main()
        {
            int scale = 4;
            Func<int, Options> make = n => new Options { Size = n * scale, Name = "made", Marks = { n, scale } };
            scale = 5;
            Options made = make(2);
            Console.WriteLine(Describe(defaults) + " " + defaults.Name);
            Console.WriteLine(Describe(made) + " " + made.Name + " " + made.Marks[1]);
            Console.WriteLine(Describe(new Options { Size = 7 }));
        }
    }
  `,
  ),
];

const diagnostics = [
  diag(
    'unknown-and-static-members',
    cs`
    class Point { public int X; public static int Count; }
    class Program
    {
        static void Main()
        {
            var a = new Point { Z = 1 };
            var b = new Point { Count = 2 };
            var c = new Point { X = 1, X = 2 };
        }
    }
  `,
  ),
  diag(
    'read-only-targets',
    cs`
    class Point
    {
        public readonly int X;
        public int Y { get; }
        public int Z { get; private set; }
        public const int K = 1;
    }
    class Program
    {
        static void Main()
        {
            var a = new Point { X = 1 };
            var b = new Point { Y = 2 };
            var c = new Point { Z = 3 };
            var d = new Point { K = 4 };
        }
    }
  `,
  ),
  diag(
    'value-conversion',
    cs`
    class Point { public int X; public string Name; }
    class Program
    {
        static void Main()
        {
            var a = new Point { X = "one" };
            var b = new Point { Name = 2, X = 1.5 };
        }
    }
  `,
  ),
  diag(
    'collection-initializer-needs-ienumerable',
    cs`
    class Bag { public void Add(int value) { } }
    class Program
    {
        static void Main()
        {
            var bag = new Bag { 1, 2 };
        }
    }
  `,
  ),
  diag(
    'collection-initializer-without-add',
    cs`
    using System.Collections;
    class Bag : IEnumerable
    {
        public IEnumerator GetEnumerator() { return null; }
    }
    class Program
    {
        static void Main()
        {
            var bag = new Bag { 1, 2 };
        }
    }
  `,
  ),
  diag(
    'add-argument-mismatch',
    cs`
    using System.Collections;
    class Bag : IEnumerable
    {
        public void Add(int value) { }
        public void Add(string key, int value) { }
        public IEnumerator GetEnumerator() { return null; }
    }
    class Program
    {
        static void Main()
        {
            var a = new Bag { 1.5 };
            var b = new Bag { { 1, 2 } };
            var c = new Bag { { "k", 1, 2 } };
        }
    }
  `,
  ),
  diag(
    'static-add',
    cs`
    using System.Collections;
    class Bag : IEnumerable
    {
        public static void Add(int value) { }
        public IEnumerator GetEnumerator() { return null; }
    }
    class Program
    {
        static void Main()
        {
            var bag = new Bag { 1 };
        }
    }
  `,
  ),
  diag(
    'nested-initializer-on-value-type-and-write-only-property',
    cs`
    struct Size { public int Width; }
    class Inner { public int Value; }
    class Box
    {
        public Size Size { get; set; }
        public Size Field;
        public Inner Hidden { set { } }
    }
    class Program
    {
        static void Main()
        {
            var a = new Box { Size = { Width = 1 } };
            var b = new Box { Field = { Width = 2 } };
            var c = new Box { Hidden = { Value = 3 } };
        }
    }
  `,
  ),
  diag(
    'nested-initializer-members',
    cs`
    using System.Collections;
    class Inner { public int Value; }
    class Bag : IEnumerable
    {
        public void Add(int value) { }
        public IEnumerator GetEnumerator() { return null; }
    }
    class Box { public Inner Inner = new Inner(); public Bag Items = new Bag(); public int Plain; }
    class Program
    {
        static void Main()
        {
            var a = new Box { Inner = { Missing = 1 } };
            var b = new Box { Items = { "text" } };
            var c = new Box { Plain = { 1 } };
        }
    }
  `,
  ),
  diag(
    'index-initializer-errors',
    cs`
    class Grid { public int this[int i] { get { return 0; } set { } } public string this[string key] { get { return key; } } }
    class Plain { }
    class Program
    {
        static void Main()
        {
            var a = new Grid { ["key"] = "value" };
            var b = new Grid { [1.5] = 2 };
            var c = new Plain { [0] = 1 };
            var d = new Grid { [0] = "text" };
        }
    }
  `,
  ),
  diag(
    'unassigned-variables-in-initializers',
    cs`
    using System.Collections.Generic;
    class Grid { public int X; public int this[int i] { get { return 0; } set { } } }
    class Program
    {
        static void Main()
        {
            int i, v, e;
            var a = new Grid { [i] = 1 };
            var b = new Grid { X = v };
            var c = new List<int> { e };
        }
    }
  `,
  ),
  diag(
    'invalid-member-declarator',
    cs`
    using System.Collections;
    class Point { public int X; }
    class Bag : IEnumerable
    {
        public void Add(int value) { }
        public IEnumerator GetEnumerator() { return null; }
    }
    class Program
    {
        static void Main()
        {
            int y = 0;
            var a = new Point { X = 1, y };
            var b = new Bag { 1, y = 2 };
        }
    }
  `,
  ),
  diag(
    'index-initializer-language-version',
    cs`
    using System.Collections.Generic;
    class Program
    {
        static void Main()
        {
            var map = new Dictionary<string, int> { ["x"] = 1 };
        }
    }
  `,
    { langVersion: '5' },
  ),
];

export const fixtures = feature('member-initializers', [...outputs, ...diagnostics]);
