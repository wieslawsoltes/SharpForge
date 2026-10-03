/** Differential fixtures: arrays, collections, lambdas, LINQ, nullable, patterns, tuples, records, async, language versions. */
import {cs,out,diag,feature} from './kit.js';

export const fixtures=[
...feature('arrays',[
  out('create-index-length',cs`
    using System;
    int[] a = new int[4];
    a[0] = 5; a[3] = a[0] * 2;
    Console.WriteLine(a.Length);
    Console.WriteLine(a[0] + a[1] + a[3]);
    string[] names = { "x", "y", "z" };
    Console.WriteLine(names[names.Length - 1]);
    double[] ds = new double[] { 1.5, 2.5 };
    Console.WriteLine(ds[0] + ds[1]);
    bool[] flags = new bool[2];
    Console.WriteLine(flags[1]);
  `),
  out('loops-over-arrays',cs`
    using System;
    int[] xs = { 4, 8, 15, 16, 23, 42 };
    int max = xs[0], sum = 0;
    for (int i = 0; i < xs.Length; i++) { sum += xs[i]; if (xs[i] > max) max = xs[i]; }
    Console.WriteLine(sum + " " + max);
    int[] squares = new int[5];
    for (int i = 0; i < squares.Length; i++) squares[i] = i * i;
    Console.WriteLine(string.Join(",", squares));
  `),
  out('rectangular',cs`
    using System;
    int[,] grid = new int[2, 3];
    for (int r = 0; r < 2; r++) for (int c = 0; c < 3; c++) grid[r, c] = r * 3 + c;
    Console.WriteLine(grid[1, 2]);
    Console.WriteLine(grid.Length);
    Console.WriteLine(grid.GetLength(0) + "x" + grid.GetLength(1));
    int[,] init = { { 1, 2 }, { 3, 4 } };
    Console.WriteLine(init[1, 0]);
  `),
  out('jagged',cs`
    using System;
    int[][] rows = new int[3][];
    for (int i = 0; i < 3; i++) { rows[i] = new int[i + 1]; rows[i][i] = i; }
    Console.WriteLine(rows[2].Length);
    Console.WriteLine(rows[2][2] + rows[1][1]);
    Console.WriteLine(rows[1][0]);
  `),
  out('sort-reverse-indexof',cs`
    using System;
    int[] xs = { 5, 2, 9, 1 };
    Array.Sort(xs);
    Console.WriteLine(string.Join(" ", xs));
    Array.Reverse(xs);
    Console.WriteLine(string.Join(" ", xs));
    Console.WriteLine(Array.IndexOf(xs, 2));
    string[] ss = { "pear", "apple", "fig" };
    Array.Sort(ss);
    Console.WriteLine(string.Join(" ", ss));
  `),
  out('bounds-and-aliasing',cs`
    using System;
    int[] a = { 1, 2, 3 };
    int[] b = a;
    b[0] = 100;
    Console.WriteLine(a[0]);
    try { Console.WriteLine(a[3]); }
    catch (IndexOutOfRangeException) { Console.WriteLine("out of range"); }
    try { Console.WriteLine(a[-1]); }
    catch (IndexOutOfRangeException) { Console.WriteLine("negative"); }
    int[] copy = (int[])a.Clone();
    copy[1] = 0;
    Console.WriteLine(a[1]);
  `),
  out('index-from-end-and-range',cs`
    using System;
    int[] xs = { 1, 2, 3, 4, 5 };
    Console.WriteLine(xs[^1]);
    int[] mid = xs[1..4];
    Console.WriteLine(string.Join(",", mid));
    Console.WriteLine(xs[..2].Length + xs[3..].Length);
  `),
  diag('cs0022-wrong-index-count',cs`
    using System;
    int[] a = new int[3];
    Console.WriteLine(a[0, 1]);
  `),
  diag('cs0029-element-type',cs`
    using System;
    int[] a = { 1, "two", 3 };
    Console.WriteLine(a.Length);
  `),
  diag('cs0029-string-index',cs`
    using System;
    int[] a = new int[3];
    Console.WriteLine(a["0"]);
  `),
  diag('cs0029-array-to-scalar',cs`
    using System;
    int[] a = new int[3];
    int x = a;
    Console.WriteLine(x);
  `),
  diag('cs0826-no-best-type',cs`
    using System;
    var a = new[] { 1, "two" };
    Console.WriteLine(a.Length);
  `),
]),
...feature('collections',[
  out('list-basics',cs`
    using System;
    using System.Collections.Generic;
    var xs = new List<int>();
    xs.Add(3); xs.Add(1); xs.Add(2);
    Console.WriteLine(xs.Count);
    Console.WriteLine(xs[0] + xs[2]);
    xs[1] = 10;
    Console.WriteLine(xs.Contains(10));
    Console.WriteLine(xs.IndexOf(2));
    xs.Remove(3);
    xs.Insert(0, 7);
    xs.RemoveAt(xs.Count - 1);
    Console.WriteLine(string.Join(",", xs));
    xs.Clear();
    Console.WriteLine(xs.Count);
  `),
  out('list-sort-and-search',cs`
    using System;
    using System.Collections.Generic;
    var names = new List<string> { "cy", "ann", "bob" };
    names.Sort();
    Console.WriteLine(string.Join(" ", names));
    names.Reverse();
    Console.WriteLine(names[0]);
    names.AddRange(new[] { "di", "ed" });
    Console.WriteLine(names.Count);
    int[] arr = names.ConvertAll(n => n.Length).ToArray();
    Console.WriteLine(arr.Length);
  `),
  out('dictionary-basics',cs`
    using System;
    using System.Collections.Generic;
    var d = new Dictionary<string, int>();
    d.Add("one", 1);
    d["two"] = 2;
    d["one"] += 10;
    Console.WriteLine(d.Count);
    Console.WriteLine(d["one"]);
    Console.WriteLine(d.ContainsKey("two") + " " + d.ContainsKey("three"));
    if (d.TryGetValue("two", out int v)) Console.WriteLine(v);
    Console.WriteLine(d.TryGetValue("nine", out int missing) + " " + missing);
    d.Remove("one");
    Console.WriteLine(d.Count);
  `),
  out('dictionary-exceptions',cs`
    using System;
    using System.Collections.Generic;
    var d = new Dictionary<string, int> { { "a", 1 }, { "b", 2 } };
    try { Console.WriteLine(d["zzz"]); }
    catch (KeyNotFoundException) { Console.WriteLine("missing key"); }
    try { d.Add("a", 5); }
    catch (ArgumentException) { Console.WriteLine("duplicate key"); }
    Console.WriteLine(d["a"] + d["b"]);
  `),
  out('word-count',cs`
    using System;
    using System.Collections.Generic;
    string text = "the cat and the hat and the bat";
    var counts = new Dictionary<string, int>();
    foreach (string w in text.Split(' '))
    {
        if (counts.ContainsKey(w)) counts[w]++;
        else counts[w] = 1;
    }
    foreach (var kv in counts) Console.WriteLine(kv.Key + ":" + kv.Value);
  `),
  out('hashset',cs`
    using System;
    using System.Collections.Generic;
    var seen = new HashSet<int>();
    int[] xs = { 1, 2, 2, 3, 1 };
    int dupes = 0;
    foreach (int x in xs) if (!seen.Add(x)) dupes++;
    Console.WriteLine(seen.Count + " " + dupes);
    Console.WriteLine(seen.Contains(3));
    seen.Remove(3);
    Console.WriteLine(seen.Contains(3));
  `),
  out('stack-and-queue',cs`
    using System;
    using System.Collections.Generic;
    var s = new Stack<int>();
    var q = new Queue<string>();
    for (int i = 1; i <= 3; i++) { s.Push(i); q.Enqueue("q" + i); }
    Console.WriteLine(s.Pop() + " " + s.Peek() + " " + s.Count);
    Console.WriteLine(q.Dequeue() + " " + q.Peek() + " " + q.Count);
    try { new Stack<int>().Pop(); }
    catch (InvalidOperationException) { Console.WriteLine("empty"); }
  `),
  out('list-of-objects',cs`
    using System;
    using System.Collections.Generic;
    var people = new List<Person> { new Person("Ann", 30), new Person("Bob", 25) };
    people.Add(new Person("Cy", 41));
    int total = 0;
    foreach (Person p in people) total += p.Age;
    Console.WriteLine(total);
    Console.WriteLine(people[1].Name);
    class Person
    {
        public string Name; public int Age;
        public Person(string n, int a) { Name = n; Age = a; }
    }
  `),
  out('list-index-out-of-range',cs`
    using System;
    using System.Collections.Generic;
    var xs = new List<int> { 1 };
    try { Console.WriteLine(xs[5]); }
    catch (ArgumentOutOfRangeException) { Console.WriteLine("out of range"); }
  `),
  out('collection-expression',cs`
    using System;
    using System.Collections.Generic;
    List<int> xs = [1, 2, 3];
    int[] ys = [.. xs, 4];
    Console.WriteLine(xs.Count + ys.Length);
  `),
  diag('cs1503-add-wrong-type',cs`
    using System;
    using System.Collections.Generic;
    var xs = new List<int>();
    xs.Add("one");
    Console.WriteLine(xs.Count);
  `),
  diag('cs0029-element-assignment',cs`
    using System;
    using System.Collections.Generic;
    var xs = new List<string> { "a" };
    int n = xs[0];
    Console.WriteLine(n);
  `),
  diag('cs1503-dictionary-key-type',cs`
    using System;
    using System.Collections.Generic;
    var d = new Dictionary<string, int>();
    d[1] = 2;
    Console.WriteLine(d.Count);
  `),
  diag('cs1501-count-as-method-without-linq',cs`
    using System;
    using System.Collections.Generic;
    var xs = new List<int>();
    Console.WriteLine(xs.Count());
  `),
]),
...feature('lambdas',[
  out('func-and-action',cs`
    using System;
    Func<int, int> twice = x => x * 2;
    Func<int, int, int> add = (a, b) => a + b;
    Action<string> say = s => Console.WriteLine("say " + s);
    Func<bool> yes = () => true;
    Console.WriteLine(twice(add(2, 3)));
    say("hi");
    Console.WriteLine(yes());
  `),
  out('closures',cs`
    using System;
    using System.Collections.Generic;
    int counter = 0;
    Action bump = () => counter++;
    bump(); bump();
    Console.WriteLine(counter);
    var actions = new List<Func<int>>();
    for (int i = 0; i < 3; i++) { int copy = i; actions.Add(() => copy * 10); }
    foreach (var f in actions) Console.WriteLine(f());
    Func<int, Func<int, int>> adder = a => b => a + b;
    Console.WriteLine(adder(3)(4));
  `),
  out('delegates',cs`
    using System;
    Op op = Add;
    Console.WriteLine(op(2, 3));
    op = (a, b) => a * b;
    Console.WriteLine(op(2, 3));
    Console.WriteLine(Apply(op, 4, 5));
    static int Add(int a, int b) { return a + b; }
    static int Apply(Op f, int a, int b) { return f(a, b); }
    delegate int Op(int a, int b);
  `),
  out('events',cs`
    using System;
    var b = new Button();
    b.Clicked += (s, e) => Console.WriteLine("first");
    b.Clicked += (s, e) => Console.WriteLine("second");
    b.Click();
    class Button
    {
        public event EventHandler Clicked;
        public void Click() { Clicked?.Invoke(this, EventArgs.Empty); }
    }
  `),
  diag('cs1593-wrong-parameter-count',cs`
    using System;
    Func<int, int> f = (a, b) => a + b;
    Console.WriteLine(f(1));
  `),
  diag('cs0029-lambda-return-type',cs`
    using System;
    Func<int, int> f = x => "text";
    Console.WriteLine(f(1));
  `),
  diag('cs1593-delegate-invocation',cs`
    using System;
    Func<int, int> f = x => x;
    Console.WriteLine(f(1, 2));
  `),
]),
...feature('linq',[
  out('where-select-sum',cs`
    using System;
    using System.Linq;
    int[] xs = { 1, 2, 3, 4, 5, 6 };
    Console.WriteLine(xs.Where(x => x % 2 == 0).Sum());
    Console.WriteLine(string.Join(",", xs.Select(x => x * x)));
    Console.WriteLine(xs.Count(x => x > 3));
    Console.WriteLine(xs.Any(x => x > 5) + " " + xs.All(x => x > 5));
    Console.WriteLine(xs.Max() + xs.Min());
    Console.WriteLine(xs.Average());
  `),
  out('ordering-and-first',cs`
    using System;
    using System.Linq;
    using System.Collections.Generic;
    var words = new List<string> { "pear", "fig", "banana", "kiwi" };
    Console.WriteLine(string.Join(" ", words.OrderBy(w => w.Length).ThenBy(w => w)));
    Console.WriteLine(words.OrderByDescending(w => w).First());
    Console.WriteLine(words.FirstOrDefault(w => w.StartsWith("z")) == null);
    Console.WriteLine(words.Skip(1).Take(2).Last());
    Console.WriteLine(words.Select(w => w.Length).Distinct().Count());
    try { words.First(w => w == "none"); }
    catch (InvalidOperationException) { Console.WriteLine("no match"); }
  `),
  out('query-syntax',cs`
    using System;
    using System.Linq;
    int[] xs = { 5, 3, 8, 1 };
    var q = from x in xs where x > 2 orderby x select x * 10;
    foreach (int v in q) Console.WriteLine(v);
    Console.WriteLine(q.ToList().Count);
  `),
  out('group-and-aggregate',cs`
    using System;
    using System.Linq;
    string[] words = { "apple", "avocado", "banana", "blueberry", "cherry" };
    foreach (var g in words.GroupBy(w => w[0])) Console.WriteLine(g.Key + ":" + g.Count());
    Console.WriteLine(words.Aggregate("", (acc, w) => acc + w[0]));
    Console.WriteLine(Enumerable.Range(1, 5).Sum());
  `),
  diag('cs1061-linq-without-using',cs`
    using System;
    int[] xs = { 1, 2 };
    Console.WriteLine(xs.Sum());
  `),
]),
...feature('nullable',[
  out('nullable-value-types',cs`
    using System;
    int? a = null;
    int? b = 5;
    Console.WriteLine(a.HasValue + " " + b.HasValue);
    Console.WriteLine(a ?? -1);
    Console.WriteLine(b.Value + 1);
    Console.WriteLine(a == null);
    Console.WriteLine((a + b) == null);
    Console.WriteLine(b.GetValueOrDefault() + a.GetValueOrDefault());
    try { Console.WriteLine(a.Value); }
    catch (InvalidOperationException) { Console.WriteLine("no value"); }
  `),
  out('null-conditional',cs`
    using System;
    string s = null;
    Console.WriteLine(s?.Length == null);
    Console.WriteLine(s?.ToUpper() ?? "none");
    s = "abc";
    Console.WriteLine(s?.Length);
    int[] xs = null;
    Console.WriteLine(xs?[0] ?? -1);
    Node n = new Node();
    Console.WriteLine(n.Next?.Next?.Value ?? 0);
    class Node { public Node Next; public int Value = 1; }
  `),
  diag('cs0037-null-to-int',cs`
    using System;
    int x = null;
    Console.WriteLine(x);
  `),
  diag('cs0266-nullable-to-int',cs`
    using System;
    int? a = 5;
    int b = a;
    Console.WriteLine(b);
  `),
  diag('cs0019-int-equals-string',cs`
    using System;
    int a = 5;
    Console.WriteLine(a == "5");
  `),
  diag('cs8602-nullable-reference-warning',cs`
    #nullable enable
    using System;
    string? s = Environment.GetEnvironmentVariable("SF_MISSING");
    Console.WriteLine(s.Length);
  `),
]),
...feature('pattern-matching',[
  out('type-and-constant-patterns',cs`
    using System;
    object[] items = { 1, "two", 3.0, null, true };
    foreach (object o in items)
    {
        if (o is int i) Console.WriteLine("int " + (i + 1));
        else if (o is string s) Console.WriteLine("string " + s.Length);
        else if (o is null) Console.WriteLine("null");
        else if (o is not bool) Console.WriteLine("other");
        else Console.WriteLine("bool");
    }
  `),
  out('relational-and-logical',cs`
    using System;
    string Grade(int score) => score switch
    {
        >= 90 => "A",
        >= 80 and < 90 => "B",
        < 0 or > 100 => "invalid",
        _ => "C",
    };
    Console.WriteLine(Grade(95) + Grade(85) + Grade(50) + Grade(-1));
    int n = 7;
    Console.WriteLine(n is > 5 and < 10);
  `),
  out('property-and-tuple-patterns',cs`
    using System;
    var p = new Point { X = 0, Y = 5 };
    string where = p switch
    {
        { X: 0, Y: 0 } => "origin",
        { X: 0 } => "y-axis",
        { Y: 0 } => "x-axis",
        _ => "plane",
    };
    Console.WriteLine(where);
    string Rps(string a, string b) => (a, b) switch
    {
        ("rock", "scissors") => "a",
        ("scissors", "rock") => "b",
        _ => "draw",
    };
    Console.WriteLine(Rps("rock", "scissors") + Rps("rock", "rock"));
    class Point { public int X { get; set; } public int Y { get; set; } }
  `),
  diag('cs8121-impossible-pattern',cs`
    using System;
    string s = "x";
    if (s is int n) Console.WriteLine(n);
  `),
  diag('cs0165-pattern-variable',cs`
    using System;
    class C
    {
        static void Main(string[] args)
        {
            object o = args;
            if (!(o is string s)) Console.WriteLine("no");
            Console.WriteLine(s);
        }
    }
  `),
]),
...feature('tuples',[
  out('literals-and-deconstruction',cs`
    using System;
    (int, string) t = (1, "one");
    Console.WriteLine(t.Item1 + t.Item2);
    var named = (Count: 2, Label: "two");
    Console.WriteLine(named.Label + named.Count);
    (int q, int r) = Divide(17, 5);
    Console.WriteLine(q + " " + r);
    var (a, b) = (10, 20);
    (a, b) = (b, a);
    Console.WriteLine(a + " " + b);
    Console.WriteLine((1, 2) == (1, 2));
    static (int Quotient, int Remainder) Divide(int x, int y) { return (x / y, x % y); }
  `),
  diag('cs8132-deconstruct-arity',cs`
    using System;
    var (a, b, c) = (1, 2);
    Console.WriteLine(a);
  `),
]),
...feature('records',[
  out('record-class',cs`
    using System;
    var a = new Person("Ann", 30);
    var b = new Person("Ann", 30);
    var c = a with { Age = 31 };
    Console.WriteLine(a == b);
    Console.WriteLine(a == c);
    Console.WriteLine(c);
    var (name, age) = c;
    Console.WriteLine(name + age);
    record Person(string Name, int Age);
  `),
  diag('cs8852-record-init-only',cs`
    using System;
    var a = new Person("Ann");
    a.Name = "Bob";
    Console.WriteLine(a);
    record Person(string Name);
  `),
]),
...feature('async',[
  out('await-completed-tasks',cs`
    using System;
    using System.Threading.Tasks;
    int a = await Task.FromResult(20);
    int b = await Twice(a);
    Console.WriteLine(a + b);
    await Task.CompletedTask;
    Console.WriteLine("done");
    static async Task<int> Twice(int x) { await Task.Yield(); return x * 2; }
  `),
  out('async-main-and-delay',cs`
    using System;
    using System.Threading.Tasks;
    class Program
    {
        static async Task Step(string name, int ms)
        {
            Console.WriteLine("start " + name);
            await Task.Delay(ms);
            Console.WriteLine("end " + name);
        }
        static async Task Main()
        {
            await Step("a", 5);
            await Step("b", 1);
            Console.WriteLine("main done");
        }
    }
  `),
  out('async-exception',cs`
    using System;
    using System.Threading.Tasks;
    try { await Fail(); }
    catch (InvalidOperationException e) { Console.WriteLine("caught " + e.Message); }
    static async Task Fail() { await Task.Delay(1); throw new InvalidOperationException("async boom"); }
  `),
  out('when-all',cs`
    using System;
    using System.Threading.Tasks;
    int[] results = await Task.WhenAll(Value(1), Value(2), Value(3));
    Console.WriteLine(results[0] + results[1] + results[2]);
    static async Task<int> Value(int v) { await Task.Delay(1); return v * 10; }
  `),
  diag('cs4033-await-in-non-async',cs`
    using System;
    using System.Threading.Tasks;
    class C
    {
        static void Run() { await Task.Delay(1); }
        static void Main() { Run(); Console.WriteLine(1); }
    }
  `),
  diag('cs1983-async-bad-return-type',cs`
    using System;
    using System.Threading.Tasks;
    class C
    {
        static async int Get() { await Task.Delay(1); return 1; }
        static void Main() { Console.WriteLine(Get().Result); }
    }
  `),
  diag('cs4014-unawaited-call',cs`
    using System;
    using System.Threading.Tasks;
    class C
    {
        static async Task Work() { await Task.Delay(1); }
        static async Task Main() { Work(); await Task.Delay(1); Console.WriteLine(1); }
    }
  `),
  diag('cs0029-task-result-type',cs`
    using System;
    using System.Threading.Tasks;
    class C
    {
        static async Task<int> Get() { await Task.Delay(1); return "one"; }
        static void Main() { Console.WriteLine(Get().Result); }
    }
  `),
]),
...feature('language-version',[
  out('csharp-7-3-program',cs`
    using System;
    class Program
    {
        static int Square(int x) => x * x;
        static void Main()
        {
            if (int.TryParse("12", out var n)) Console.WriteLine(Square(n));
            object o = "text";
            if (o is string s) Console.WriteLine(s.Length);
            var t = (a: 1, b: 2);
            Console.WriteLine(t.a + t.b);
        }
    }
  `,{langVersion:'7.3'}),
  out('csharp-5-program',cs`
    using System;
    class Program
    {
        static void Main()
        {
            int x;
            if (!int.TryParse("12", out x)) x = -1;
            Console.WriteLine(string.Format("{0}", x));
        }
    }
  `,{langVersion:'5'}),
  diag('switch-expression-in-7-3',cs`
    using System;
    class Program
    {
        static void Main()
        {
            int n = 1;
            string s = n switch { 1 => "one", _ => "other" };
            Console.WriteLine(s);
        }
    }
  `,{langVersion:'7.3'}),
  diag('using-declaration-in-7-3',cs`
    using System;
    using System.IO;
    class Program
    {
        static void Main()
        {
            using var r = new StringReader("x");
            Console.WriteLine(r.ReadLine());
        }
    }
  `,{langVersion:'7.3'}),
  diag('null-coalescing-assignment-in-7-3',cs`
    using System;
    class Program
    {
        static void Main()
        {
            string s = null;
            s ??= "x";
            Console.WriteLine(s);
        }
    }
  `,{langVersion:'7.3'}),
  diag('top-level-statements-in-8',cs`
    using System;
    Console.WriteLine(1);
  `,{langVersion:'8.0'}),
  diag('file-scoped-namespace-in-9',cs`
    using System;
    namespace Demo;
    class Program { static void Main() { Console.WriteLine(1); } }
  `,{langVersion:'9.0'}),
  diag('record-in-8',cs`
    using System;
    class Program { static void Main() { Console.WriteLine(new P(1)); } }
    record P(int X);
  `,{langVersion:'8.0'}),
  diag('target-typed-new-in-8',cs`
    using System;
    using System.Text;
    class Program
    {
        static void Main() { StringBuilder sb = new(); Console.WriteLine(sb.Length); }
    }
  `,{langVersion:'8.0'}),
  diag('interpolated-string-in-5',cs`
    using System;
    class Program
    {
        static void Main() { int n = 1; Console.WriteLine($"n={n}"); }
    }
  `,{langVersion:'5'}),
  diag('out-var-in-6',cs`
    using System;
    class Program
    {
        static void Main() { if (int.TryParse("1", out var n)) Console.WriteLine(n); }
    }
  `,{langVersion:'6'}),
  diag('expression-bodied-member-in-5',cs`
    using System;
    class Program
    {
        static int One() => 1;
        static void Main() { Console.WriteLine(One()); }
    }
  `,{langVersion:'5'}),
  diag('pattern-matching-in-6',cs`
    using System;
    class Program
    {
        static void Main() { object o = 1; if (o is int n) Console.WriteLine(n); }
    }
  `,{langVersion:'6'}),
  diag('collection-expression-in-11',cs`
    using System;
    class Program
    {
        static void Main() { int[] xs = [1, 2, 3]; Console.WriteLine(xs.Length); }
    }
  `,{langVersion:'11.0'}),
  diag('raw-string-in-10',cs`
    using System;
    class Program
    {
        static void Main() { Console.WriteLine("""raw"""); }
    }
  `,{langVersion:'10.0'}),
  diag('default-literal-in-7-0',cs`
    using System;
    class Program
    {
        static void Main() { int n = default; Console.WriteLine(n); }
    }
  `,{langVersion:'7.0'}),
  diag('nullable-reference-types-in-7-3',cs`
    using System;
    class Program
    {
        static void Main() { string? s = null; Console.WriteLine(s == null); }
    }
  `,{langVersion:'7.3'}),
]),
];
