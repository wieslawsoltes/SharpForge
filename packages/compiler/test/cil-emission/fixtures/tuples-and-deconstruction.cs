using System;

struct Point
{
    public int X;
    public int Y;
    public Point(int x, int y) { X = x; Y = y; }
    public void Deconstruct(out int x, out int y) { x = X; y = Y; }
}

class Person
{
    public string Name;
    public int Age;
    public Person(string name, int age) { Name = name; Age = age; }
}

static class PersonExtensions
{
    public static void Deconstruct(this Person person, out string name, out int age)
    {
        name = person.Name;
        age = person.Age;
    }
}

class Holder
{
    public (int Count, string Label) Pair;
    public (int, long)[] Items = new (int, long)[2];
    public (string First, string Last) Names { get; set; }
    int[] slots = new int[16];
    public int this[int index]
    {
        get { return slots[index]; }
        set { Console.WriteLine("set[" + index + "]=" + value); slots[index] = value; }
    }
}

class Program
{
    static int calls;

    static (int Sum, int Product) Compute(int a, int b)
    {
        return (a + b, a * b);
    }

    static (string, (int, int)) Nested(string name)
    {
        return (name, (name.Length, 2));
    }

    static int Next(string label)
    {
        calls++;
        Console.WriteLine("eval " + label);
        return calls;
    }

    static string Describe((int, int) value)
    {
        switch (value)
        {
            case (0, 0): return "origin";
            case (var x, 0): return "x axis " + x;
            case (0, var y): return "y axis " + y;
            case var (x, y) when x == y: return "diagonal " + x;
            default: return "plane";
        }
    }

    static string Kind(object value)
    {
        return value switch
        {
            Point (0, 0) => "point origin",
            Point (var x, var y) => "point " + x + "," + y,
            Person (var name, > 17) => "adult " + name,
            Person (var name, _) => "minor " + name,
            _ => "other"
        };
    }

    static void Main()
    {
        // Literals, elements, names and copies.
        var pair = (1, "one");
        Console.WriteLine(pair.Item1 + " " + pair.Item2);
        (int Count, string Label) named = pair;
        named.Count += 41;
        Console.WriteLine(named.Count + " " + named.Label + " " + pair.Item1);
        Console.WriteLine(pair);
        Console.WriteLine(Compute(3, 4).Product);
        var computed = Compute(5, 6);
        Console.WriteLine(computed.Sum + " " + computed.Product);
        var nested = Nested("abc");
        Console.WriteLine(nested.Item2.Item1 + nested.Item1);
        Console.WriteLine(nested);

        // Long tuples nest in Rest.
        var wide = (1, 2, 3, 4, 5, 6, 7, 8, 9, "ten");
        Console.WriteLine(wide.Item1 + wide.Item7 + wide.Item8 + wide.Item9);
        wide.Item9 = 90;
        Console.WriteLine(wide.Item9 + " " + wide.Item10 + " " + wide.Rest.Item2);
        Console.WriteLine(wide);
        var eight = (1, 2, 3, 4, 5, 6, 7, 8);
        Console.WriteLine(eight.Item8 + " " + eight);

        // Conversions: literal to target, value to value.
        (long, object) widened = (5, "text");
        Console.WriteLine(widened);
        (long, object) converted = pair;
        Console.WriteLine(converted);
        (int, string) nulls = (0, null);
        Console.WriteLine(nulls.Item2 == null);
        (double, long)? optional = (1, 2);
        Console.WriteLine(optional.HasValue);

        // Equality, element by element, operands evaluated once.
        Console.WriteLine(pair == (1, "one"));
        Console.WriteLine(pair != (1, "two"));
        string half = "on";
        string built = half + "e";
        Console.WriteLine(pair == (1, built));
        Console.WriteLine(built == pair.Item2);
        Console.WriteLine((Next("a"), Next("b")) == (Next("c"), 2));
        Console.WriteLine(nested == ("abc", (3, 2)));
        Console.WriteLine((1L, 2) == (1, 2L));
        Console.WriteLine(wide == (1, 2, 3, 4, 5, 6, 7, 8, 90, "ten"));

        // Deconstruction into new and existing variables, fields, elements, properties.
        var (sum, product) = Compute(2, 5);
        Console.WriteLine(sum + " " + product);
        (int first, string second) = pair;
        Console.WriteLine(first + second);
        int a = 1, b = 2;
        (a, b) = (b, a);
        Console.WriteLine(a + " " + b);
        long big;
        string text;
        (big, text) = pair;
        Console.WriteLine(big + text);
        var holder = new Holder();
        (holder.Pair, holder.Items[1]) = ((7, "seven"), (1, 2L));
        Console.WriteLine(holder.Pair.Count + holder.Pair.Label + holder.Items[1].Item2);
        (holder[Next("i")], holder[Next("j")]) = (Next("v"), Next("w"));
        holder.Names = ("Ada", "Lovelace");
        var (given, family) = holder.Names;
        Console.WriteLine(given + " " + family);
        (string name, (int length, _)) = Nested("hello");
        Console.WriteLine(name + length);
        var (w1, _, _, _, _, _, _, w8, w9, w10) = wide;
        Console.WriteLine(w1 + w8 + w9 + w10);

        // Deconstruct methods: instance on a struct, extension on a class.
        var (px, py) = new Point(3, 4);
        Console.WriteLine(px * py);
        (string who, int age) = new Person("Ann", 30);
        Console.WriteLine(who + age);
        (double dx, long dy) = new Point(8, 9);
        Console.WriteLine(dx / 2 + " " + dy);

        // foreach deconstructs each element.
        var points = new[] { (1, "a"), (2, "b") };
        foreach (var (number, letter) in points) Console.WriteLine(number + letter);
        foreach ((int x, int y) in new[] { new Point(1, 2), new Point(3, 4) }) Console.WriteLine(x + y);

        // Patterns.
        Console.WriteLine(Describe((0, 0)) + "; " + Describe((5, 0)) + "; " + Describe((0, 6)) + "; " + Describe((2, 2)) + "; " + Describe((1, 2)));
        Console.WriteLine(Kind(new Point(0, 0)) + "; " + Kind(new Point(1, 2)) + "; " + Kind(new Person("Bo", 20)) + "; " + Kind(new Person("Cy", 9)) + "; " + Kind(1));
        Console.WriteLine(pair is (1, var label) ? label : "no");

        // The value of a deconstruction.
        int m, n;
        var both = ((m, n) = (10, 20));
        Console.WriteLine(both.Item1 + both.Item2 + m + n);
        Console.WriteLine(default((int, string)).Item1);
        Console.WriteLine(pair.Equals((1, "one")) + " " + pair.ToString());
    }
}
