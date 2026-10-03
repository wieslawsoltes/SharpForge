/**
 * Differential fixtures for SF-A02-T02.6 (lowering of user-defined generics): generic classes, methods and delegates
 * declared in source run as one image class or method per closed construction. Every output program here runs from
 * the semantic code generator; the pinned output is what the same program prints on .NET.
 */
import { cs, out, diag, feature } from './kit.js';

const outputs = [
  out(
    'classes-members-and-statics-per-construction',
    cs`
    using System;
    class Box<T>
    {
        public static int Created;
        static string label = "box";
        T value;
        public T Value { get { return value; } set { this.value = value; } }
        public Box(T value) { this.value = value; Created++; }
        public static string Label() { return label + Created; }
    }
    class Pair<A, B>
    {
        public A First { get; }
        public B Second { get; set; }
        public Pair(A first, B second) { First = first; Second = second; }
        public Pair<B, A> Swap() { return new Pair<B, A>(Second, First); }
    }
    class Tally<T>
    {
        public static readonly string Kind = "tally";
        static int next;
        static Tally() { next = 100; }
        public static int Next() { next++; return next; }
    }
    class Program
    {
        static void Main()
        {
            var bi = new Box<int>(5);
            var bs = new Box<string>("hi");
            var b2 = new Box<int>(7);
            bi.Value = bi.Value + 1;
            Console.WriteLine(bi.Value + b2.Value);
            Console.WriteLine(bs.Value);
            Console.WriteLine(Box<int>.Created + " " + Box<string>.Created + " " + Box<double>.Created);
            Console.WriteLine(Box<int>.Label() + Box<double>.Label());
            var p = new Pair<string, int>("k", 2);
            var q = p.Swap();
            q.Second = q.Second + "!";
            Console.WriteLine(q.First + 1);
            Console.WriteLine(q.Second);
            Console.WriteLine(Tally<int>.Kind + Tally<int>.Next() + Tally<int>.Next());
            Console.WriteLine(Tally<string>.Next());
        }
    }
  `,
  ),
  out(
    'methods-inferred-explicit-and-default',
    cs`
    using System;
    class Pair<A, B>
    {
        public A First; public B Second;
        public Pair(A first, B second) { First = first; Second = second; }
    }
    static class Util
    {
        public static T Identity<T>(T x) { return x; }
        public static T[] Fill<T>(int n, T value) { var a = new T[n]; for (int i = 0; i < n; i++) a[i] = value; return a; }
        public static T OrDefault<T>(bool use, T value) { return use ? value : default(T); }
        public static T Fallback<T>() { T none = default; return none; }
        public static Pair<T, U> Zip<T, U>(T a, U b) { return new Pair<T, U>(a, b); }
        public static void Show<T>(T value) { Console.WriteLine(value); }
        public static int Count<T>(T[] items) { return items.Length; }
    }
    class Program
    {
        static void Main()
        {
            Console.WriteLine(Util.Identity(3) + Util.Identity<int>(4));
            Console.WriteLine(Util.Identity("s") + Util.Identity<string>("t"));
            Console.WriteLine(Util.Fill(3, "z").Length + Util.Fill(2, 1.5)[1]);
            Console.WriteLine(Util.OrDefault(false, 9));
            Console.WriteLine(Util.OrDefault(false, "x") == null);
            Console.WriteLine(Util.OrDefault(true, 2.5));
            Console.WriteLine(Util.OrDefault(false, true));
            Console.WriteLine(Util.Fallback<int>() + Util.Fallback<double>());
            var z = Util.Zip(1, "one");
            Console.WriteLine(z.First + z.Second);
            Util.Show("text"); Util.Show(7); Util.Show(true); Util.Show(0.5);
            Console.WriteLine(Util.Count(new[] { 1, 2, 3 }) + Util.Count(new string[2]));
        }
    }
  `,
  ),
  out(
    'self-referencing-classes-and-null',
    cs`
    using System;
    class Node<T>
    {
        public T Item;
        public Node<T> Next;
        public Node(T item, Node<T> next) { Item = item; Next = next; }
    }
    class Stack<T>
    {
        Node<T> head;
        int count;
        public int Count => count;
        public void Push(T item) { head = new Node<T>(item, head); count++; }
        public T Pop() { T item = head.Item; head = head.Next; count--; return item; }
        public T PeekOr(T fallback) { return head == null ? fallback : head.Item; }
        public bool IsEmpty { get { return head == null; } }
    }
    class Program
    {
        static bool Missing<T>(T value) where T : class { return value == null; }
        static void Main()
        {
            var words = new Stack<string>();
            words.Push("a"); words.Push("b"); words.Push("c");
            Console.WriteLine(words.Pop() + words.Pop() + words.Count);
            var numbers = new Stack<int>();
            Console.WriteLine(numbers.PeekOr(-1) + " " + numbers.IsEmpty);
            numbers.Push(4);
            Console.WriteLine(numbers.PeekOr(-1) + " " + numbers.IsEmpty);
            var stacks = new Stack<Stack<int>>();
            stacks.Push(numbers);
            Console.WriteLine(stacks.Pop().Pop());
            Console.WriteLine(Missing<string>(null) + " " + Missing("s") + " " + Missing(words));
        }
    }
  `,
  ),
  out(
    'constraints-bind-calls-to-the-closed-type',
    cs`
    using System;
    interface IShape
    {
        int Area();
        string Name { get; }
    }
    class Square : IShape
    {
        int side;
        public Square(int side) { this.side = side; }
        public int Area() { return side * side; }
        public string Name { get { return "square"; } }
    }
    class Rect : IShape
    {
        int w, h;
        public Rect() { w = 2; h = 3; }
        public int Area() { return w * h; }
        string IShape.Name { get { return "rect"; } }
    }
    static class Shapes
    {
        public static int TotalArea<T>(T[] shapes) where T : IShape { int sum = 0; foreach (var s in shapes) sum += s.Area(); return sum; }
        public static string Describe<T>(T shape) where T : class, IShape { return shape.Name + ":" + shape.Area(); }
        public static T Make<T>() where T : new() { return new T(); }
        public static T Fresh<T>() where T : IShape, new() { T made = new T(); return made; }
        public static T Copy<T>(T value) where T : struct { T copy = value; return copy; }
    }
    class Program
    {
        static void Main()
        {
            Console.WriteLine(Shapes.TotalArea(new[] { new Square(2), new Square(3) }));
            Console.WriteLine(Shapes.Describe(new Square(4)));
            Console.WriteLine(Shapes.Describe(new Rect()));
            Console.WriteLine(Shapes.Make<Rect>().Area());
            Console.WriteLine(Shapes.Fresh<Rect>().Area() + Shapes.Make<int>());
            Console.WriteLine(Shapes.Make<bool>());
            Console.WriteLine(Shapes.Copy(2.5) + Shapes.Copy(1));
        }
    }
  `,
  ),
  out(
    'generic-interface-implemented-by-a-generic-class',
    cs`
    using System;
    interface IContainer<T>
    {
        T Get(int index);
        int Count { get; }
    }
    class Bag<T> : IContainer<T>
    {
        T[] items = new T[4];
        int count;
        public int Count { get { return count; } }
        public T this[int index] { get { return items[index]; } set { items[index] = value; } }
        public T Get(int index) { return items[index]; }
        public void Add(T item) { items[count] = item; count++; }
    }
    static class Containers
    {
        public static int Sum<C>(C container) where C : IContainer<int>
        {
            int total = 0;
            for (int i = 0; i < container.Count; i++) total += container.Get(i);
            return total;
        }
        public static T Last<C, T>(C container) where C : IContainer<T> { return container.Get(container.Count - 1); }
    }
    class Program
    {
        static void Main()
        {
            var bag = new Bag<int>();
            bag.Add(3); bag.Add(4);
            bag[1] = 5;
            Console.WriteLine(bag[0] + bag[1]);
            Console.WriteLine(Containers.Sum(bag));
            var names = new Bag<string>();
            names.Add("a"); names.Add("b");
            Console.WriteLine(Containers.Last<Bag<string>, string>(names) + Containers.Last<Bag<int>, int>(bag));
        }
    }
  `,
  ),
  out(
    'nested-generics-and-generic-methods-of-generic-classes',
    cs`
    using System;
    class Box<T>
    {
        public T Value;
        public Box(T value) { Value = value; }
        public Box<U> Map<U>(Func<T, U> f) { return new Box<U>(f(Value)); }
        public Box<Box<T>> Wrap() { return new Box<Box<T>>(this); }
    }
    class Outer<T>
    {
        public static int Made;
        public class Inner<U>
        {
            public T Left;
            public U Right;
            public string Show() { Made++; return Left + "/" + Right; }
        }
        public class Plain
        {
            public T Only;
        }
    }
    class Program
    {
        static void Main()
        {
            var nested = new Box<Box<int>>(new Box<int>(42));
            Console.WriteLine(nested.Value.Value);
            var mapped = nested.Value.Map(x => "n" + x).Map(s => s.Length);
            Console.WriteLine(mapped.Value);
            Console.WriteLine(new Box<string>("w").Wrap().Wrap().Value.Value.Value);
            var inner = new Outer<int>.Inner<string>();
            inner.Left = 1; inner.Right = "r";
            var other = new Outer<string>.Inner<double>();
            other.Left = "l"; other.Right = 2.5;
            Console.WriteLine(inner.Show() + " " + other.Show() + " " + inner.Show());
            Console.WriteLine(Outer<int>.Made + " " + Outer<string>.Made + " " + Outer<bool>.Made);
            var plain = new Outer<double>.Plain();
            plain.Only = 0.25;
            Console.WriteLine(plain.Only);
        }
    }
  `,
  ),
  out(
    'generic-delegates-lambdas-and-method-groups',
    cs`
    using System;
    delegate TResult Transformer<T, TResult>(T input);
    delegate void Sink<T>(T item);
    class Bag<T>
    {
        T[] items = new T[4];
        int count;
        public void Add(T item) { items[count] = item; count++; }
        public Bag<R> Select<R>(Transformer<T, R> f) { var r = new Bag<R>(); for (int i = 0; i < count; i++) r.Add(f(items[i])); return r; }
        public void Each(Sink<T> sink) { for (int i = 0; i < count; i++) sink(items[i]); }
    }
    static class Functions
    {
        public static T Twice<T>(T value, Func<T, T> f) { return f(f(value)); }
        public static Func<T> Later<T>(T value) { return () => value; }
        public static T Id<T>(T x) { return x; }
        public static Func<A, C> Compose<A, B, C>(Func<A, B> first, Func<B, C> second) { return a => second(first(a)); }
    }
    class Program
    {
        static void Print(string s) { Console.WriteLine(s); }
        static void Main()
        {
            var bag = new Bag<int>();
            bag.Add(3); bag.Add(5);
            int total = 0;
            bag.Each(n => total += n);
            Console.WriteLine(total);
            Sink<string> printer = Print;
            bag.Select<string>(n => "#" + n).Each(printer);
            Transformer<int, bool> even = n => n % 2 == 0;
            Console.WriteLine(even(4) + " " + even(5));
            Console.WriteLine(Functions.Twice(3, v => v * v));
            Console.WriteLine(Functions.Twice("a", v => v + v));
            var later = Functions.Later("soon");
            Console.WriteLine(later() + Functions.Later(7)());
            Func<int, int> f = Functions.Id;
            Func<string, string> g = Functions.Id<string>;
            Console.WriteLine(f(2) + g("s"));
            var length = Functions.Compose<int, string, int>(n => "x" + n, s => s.Length);
            Console.WriteLine(length(1000));
        }
    }
  `,
  ),
  out(
    'iterators-async-and-local-functions',
    cs`
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    class Ring<T>
    {
        T[] items;
        public Ring(T[] items) { this.items = items; }
        public IEnumerable<T> From(int start)
        {
            for (int i = 0; i < items.Length; i++) yield return items[(start + i) % items.Length];
        }
    }
    static class Sequences
    {
        public static IEnumerable<T> Repeat<T>(T value, int times) { for (int i = 0; i < times; i++) yield return value; }
        public static async Task<T> Delayed<T>(T value) { await Task.Delay(1); return value; }
        public static async Task<int> CountAsync<T>(T[] items) { int n = await Delayed(items.Length); return n; }
    }
    class Program
    {
        static async Task Main()
        {
            foreach (var s in new Ring<string>(new[] { "a", "b", "c" }).From(1)) Console.WriteLine(s);
            foreach (var n in new Ring<int>(new[] { 1, 2 }).From(1)) Console.WriteLine(n);
            foreach (var d in Sequences.Repeat(0.5, 2)) Console.WriteLine(d);
            Console.WriteLine(await Sequences.Delayed(41) + 1);
            Console.WriteLine(await Sequences.Delayed("done"));
            Console.WriteLine(await Sequences.CountAsync(new[] { true, false, true }));
            int calls = 0;
            T Pick<T>(bool first, T a, T b) { calls++; return first ? a : b; }
            void Swap<T>(ref T a, ref T b) { T t = a; a = b; b = t; }
            Console.WriteLine(Pick(true, 1, 2) + Pick(false, "x", "y") + calls);
            string left = "l", right = "r";
            Swap(ref left, ref right);
            int one = 1, two = 2;
            Swap(ref one, ref two);
            Console.WriteLine(left + right + one + two);
        }
    }
  `,
  ),
  out(
    'events-arrays-tuples-enums-and-extensions',
    cs`
    using System;
    enum Color { Red, Green }
    class Counter<T> where T : class
    {
        public static int Uses;
        public T Last;
        public event Action<T> Changed;
        public void Set(T value) { Last = value; Uses++; if (Changed != null) Changed(value); }
    }
    class Cell<T>
    {
        public T Value;
        public static int Count;
        public Cell(T value) { Value = value; Count++; }
    }
    static class Extensions
    {
        public static T FirstOr<T>(this T[] items, T fallback) { return items.Length > 0 ? items[0] : fallback; }
        public static Cell<T> ToCell<T>(this T value) { return new Cell<T>(value); }
    }
    class Program
    {
        static void Main()
        {
            var counter = new Counter<string>();
            counter.Changed += s => Console.WriteLine("changed " + s);
            counter.Set("a"); counter.Set("b");
            Console.WriteLine(Counter<string>.Uses + counter.Last);
            Console.WriteLine(new[] { 7, 8 }.FirstOr(0) + new string[0].FirstOr("none"));
            Cell<string>[] cells = new Cell<string>[2];
            cells[0] = "x".ToCell();
            cells[1] = new Cell<string>("y");
            Console.WriteLine(cells[0].Value + cells[1].Value + cells.Length);
            var pair = (5.ToCell(), "t");
            pair.Item1.Value += 1;
            Console.WriteLine(pair.Item1.Value + pair.Item2);
            var colored = new Cell<Color>(Color.Green);
            Console.WriteLine((int)colored.Value + " " + Cell<Color>.Count + " " + Cell<int>.Count + " " + Cell<string>.Count);
        }
    }
  `,
  ),
];

const diagnostics = [
  diag(
    'cs0304-cs0417-creating-a-type-parameter',
    cs`
    class Factory
    {
        static T Plain<T>() { return new T(); }
        static T WithArguments<T>() where T : new() { return new T(1); }
        static void Main() { }
    }
  `,
  ),
  diag(
    'cs0310-cs0452-cs0453-constraints-of-user-generics',
    cs`
    class NoDefault { public NoDefault(int x) { } }
    class NeedsNew<T> where T : new() { }
    class RefOnly<T> where T : class { }
    static class Util
    {
        public static T Value<T>(T x) where T : struct { return x; }
    }
    class Program
    {
        static void Main()
        {
            var a = new NeedsNew<NoDefault>();
            var b = new RefOnly<int>();
            var c = Util.Value("s");
        }
    }
  `,
  ),
  diag(
    'cs0305-cs0308-arity-of-user-generics',
    cs`
    class Box<T> { public T Value; }
    class Program
    {
        static T Id<T>(T x) { return x; }
        static int Plain(int x) { return x; }
        static void Main()
        {
            Box<int, int> wide = null;
            int a = Id<int, int>(1);
            int b = Plain<int>(2);
        }
    }
  `,
  ),
  diag(
    'cs0411-cs0311-inference-and-interface-constraints',
    cs`
    interface IShape { int Area(); }
    class Blob { }
    class Program
    {
        static T Make<T>() { return default(T); }
        static int Area<T>(T shape) where T : IShape { return shape.Area(); }
        static void Main()
        {
            var made = Make();
            int area = Area(new Blob());
        }
    }
  `,
  ),
  diag(
    'cs0029-cs1503-constructions-are-distinct-types',
    cs`
    class Box<T> { public T Value; }
    class Program
    {
        static void Take(Box<int> box) { }
        static void Main()
        {
            Box<int> a = new Box<string>();
            Take(new Box<double>());
            string s = new Box<int>().Value;
        }
    }
  `,
  ),
];

export const fixtures = feature('generic-lowering', [...outputs, ...diagnostics]);
