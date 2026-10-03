/**
 * Programs whose semantic-model answers are pinned against Roslyn (SF-A02-T38). `tools/pin.mjs` asks Roslyn's
 * SemanticModel about every expression and declaration of each program and writes `pinned.json`; the test asks the
 * model over the semantic analysis the same questions at the same spans.
 *
 * The first program stays inside the execution profile; the others use what only the semantic analysis binds
 * (structs, interfaces, enums, generics, inheritance, lambdas, tuples, patterns).
 */
import { cs } from '../differential/fixtures/kit.js';

export const programs = [
  {
    id: 'classes-and-statements',
    source: cs`
    using System;
    using System.Collections.Generic;
    namespace Shop
    {
        class Cart
        {
            public int Count;
            public string Owner { get; set; }
            public Cart(string owner) { Owner = owner; }
            public int Add(int amount)
            {
                const int Limit = 10;
                int next = Count + amount;
                if (next > Limit) { string note = "full"; Program.Print(note); return Count; }
                Count = next;
                return Count;
            }
            public static double Half(double value) { return value / 2; }
        }
        class Program
        {
            public static void Print(string text) { Console.WriteLine((object)text); }
            static void Main()
            {
                var cart = new Shop.Cart("ann");
                var items = new List<int> { 1, 2 };
                int total = cart.Add(3) + items.Count;
                foreach (var item in items) { total += item; }
                double half = Cart.Half(total);
                Print($"{cart.Owner}: {total} {half}");
                long wide = total;
                bool big = wide > 5 && !(total == 0);
                string text = big ? "big" : null;
                Print(text ?? "small");
            }
        }
    }
    `,
  },
  {
    id: 'structs-interfaces-enums',
    source: cs`
    using System;
    enum Color { Red, Green = 4, Blue }
    interface IShape { double Area { get; } string Name(); }
    struct Point
    {
        public int X, Y;
        public Point(int x, int y) { X = x; Y = y; }
        public static Point operator +(Point a, Point b) { return new Point(a.X + b.X, a.Y + b.Y); }
        public int this[int index] { get { return index == 0 ? X : Y; } }
        public override string ToString() { return X + "," + Y; }
    }
    class Square : IShape
    {
        readonly double side;
        public const int Corners = 4;
        public Square(double side) { this.side = side; }
        public double Area { get { return side * side; } }
        public string Name() { return nameof(Square); }
    }
    class Program
    {
        static T First<T>(T[] values) where T : struct { return values[0]; }
        static void Print(string text) { }
        static void Main()
        {
            var p = new Point(1, 2) + new Point(3, 4);
            int first = p[0];
            Color c = Color.Green;
            int raw = (int)c + Square.Corners;
            IShape shape = new Square(2);
            double area = shape.Area;
            object boxed = p;
            Point back = (Point)boxed;
            int[] numbers = { 1, 2, 3 };
            int head = First(numbers);
            Print(shape.Name() + area + raw + back.X + head + first + (c == Color.Blue));
        }
    }
    `,
  },
  {
    id: 'generics-lambdas-patterns',
    source: cs`
    using System;
    using System.Collections.Generic;
    class Box<T>
    {
        public T Value;
        public Box(T value) { Value = value; }
        public Box<U> Map<U>(Func<T, U> map) { return new Box<U>(map(Value)); }
    }
    static class Program
    {
        static string Describe(object value)
        {
            switch (value)
            {
                case int n when n > 10: return "big " + n;
                case string s: return s + s.Length;
                case null: return "null";
                default: return "other";
            }
        }
        static (int count, string label) Pair(int n) { return (n, n > 1 ? "many" : "one"); }
        static void Print(string text) { }
        static void Main()
        {
            var box = new Box<int>(20);
            Box<string> text = box.Map(v => "v" + v);
            Func<int, int> twice = x => x * 2;
            int? maybe = null;
            int value = maybe ?? twice(4);
            var pair = Pair(value);
            var (count, label) = pair;
            var names = new Dictionary<string, int>();
            names["a"] = pair.count;
            bool isText = Describe(text.Value) is string described && described.Length > 0;
            Print(Describe(box.Value) + label + count + names["a"] + isText);
        }
    }
    `,
  },
  {
    id: 'inheritance-and-statics',
    source: cs`
    using System;
    namespace Zoo.Animals
    {
        abstract class Animal
        {
            protected readonly string name;
            public static int Created;
            protected Animal(string name) { this.name = name; Created++; }
            public abstract string Sound();
            public virtual string Describe() { return name + " says " + Sound(); }
            public class Tag { public int Id; }
        }
        class Dog : Animal
        {
            public Dog(string name) : base(name) { }
            public override string Sound() { return "woof"; }
            public override string Describe() { return base.Describe() + "!"; }
        }
    }
    namespace Zoo
    {
        using Zoo.Animals;
        class Program
        {
            static int Count(params Animal[] animals) { return animals.Length; }
            static void Print(string text) { }
            static void Main()
            {
                Animal pet = new Dog("rex");
                Dog dog = pet as Dog;
                var tag = new Animal.Tag { Id = 7 };
                int n = Count(pet, dog);
                string text = pet.Describe();
                bool isDog = pet is Dog;
                Type type = typeof(Dog);
                object boxedType = type;
                Print(text + n + tag.Id + Animal.Created + isDog + boxedType + default(int));
            }
        }
    }
    `,
  },
];
