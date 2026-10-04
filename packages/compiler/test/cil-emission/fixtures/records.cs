using System;

record Point(int X, int Y);

record Named(string Name, int X, int Y) : Point(X, Y)
{
    public string Tag { get; init; } = "none";
}

sealed record Labeled(string Label, string Name, int X, int Y) : Named(Name, X, Y);

abstract record Shape(string Kind)
{
    public abstract double Area { get; }
}

record Circle(double Radius) : Shape("circle")
{
    public override double Area => 3 * Radius * Radius;
}

record Square(double Side) : Shape("square")
{
    public override double Area => Side * Side;
}

record Temperature(double Degrees)
{
    public override string ToString() { return Degrees + " deg"; }
    public virtual bool Equals(Temperature other) { return other != null && (int)Degrees == (int)other.Degrees; }
    public override int GetHashCode() { return (int)Degrees; }
}

record struct Vector(int Dx, int Dy)
{
    public int Length2 => Dx * Dx + Dy * Dy;
}

readonly record struct Money(long Amount, string Currency);

record Box<T>(T Value, string Label)
{
    public int Uses;
}

record Options
{
    public required string Name { get; init; }
    public int Level { get; init; } = 1;
    public bool Verbose { get; set; }
}

class Account
{
    public required string Owner { get; init; }
    public required int Balance;
    public string Note { get; init; }
}

class Program
{
    static bool SameAsPoints(Point a, Point b) { return a == b; }

    static void Main()
    {
        // Positional records: construction, properties, text, equality, hash, deconstruction.
        var p = new Point(1, 2);
        var q = new Point(1, 2);
        Console.WriteLine(p);
        Console.WriteLine(p == q);
        Console.WriteLine(p != q);
        Console.WriteLine(p.Equals(q) + " " + p.Equals((object)q) + " " + p.Equals(null) + " " + ReferenceEquals(p, q));
        Console.WriteLine(p.GetHashCode() == q.GetHashCode());
        var (px, py) = p;
        Console.WriteLine(px + py);
        Point nothing = null;
        Console.WriteLine((nothing == null) + " " + (nothing == p) + " " + (p != nothing));

        // with: a copy of the run-time type, then the init accessors.
        var moved = p with { X = 10 };
        Console.WriteLine(moved + " " + p);
        Console.WriteLine(p with { } == p);

        // Inheritance: the derived record adds members; equality and text are virtual.
        var n = new Named("n", 1, 2) { Tag = "t" };
        Console.WriteLine(n);
        Console.WriteLine(n.X + n.Y + n.Name + n.Tag);
        Point asPoint = n;
        Console.WriteLine(asPoint);
        Console.WriteLine(SameAsPoints(n, p));
        Console.WriteLine(SameAsPoints(p, n));
        Console.WriteLine(SameAsPoints(n, new Named("n", 1, 2) { Tag = "t" }));
        Console.WriteLine(SameAsPoints(n, new Named("m", 1, 2) { Tag = "t" }));
        Console.WriteLine(SameAsPoints(n, new Named("n", 1, 2)));
        Point copy = asPoint with { Y = 20 };
        Console.WriteLine(copy);
        Console.WriteLine(copy is Named);
        var labeled = new Labeled("l", "n", 3, 4);
        Console.WriteLine(labeled);
        Console.WriteLine(labeled with { Label = "L", X = 30 });
        var (label, name, lx, ly) = labeled;
        Console.WriteLine(label + name + lx + ly);
        Console.WriteLine(labeled.GetHashCode() == (labeled with { }).GetHashCode());

        // Abstract records and declared members that replace synthesized ones.
        Shape[] shapes = { new Circle(2), new Square(3) };
        foreach (Shape shape in shapes) Console.WriteLine(shape + " " + shape.Kind + " " + shape.Area);
        Console.WriteLine(shapes[0] == new Circle(2));
        Console.WriteLine(shapes[0] == shapes[1]);
        var warm = new Temperature(20.5);
        Console.WriteLine(warm);
        Console.WriteLine(warm == new Temperature(20.9));
        Console.WriteLine(warm == new Temperature(21.5));

        // Record structs.
        var v = new Vector(3, 4);
        var w = v with { Dy = 5 };
        Console.WriteLine(v + " " + w + " " + v.Length2);
        Console.WriteLine((v == new Vector(3, 4)) + " " + (v != w) + " " + v.Equals(w) + " " + v.Equals((object)new Vector(3, 4)));
        v.Dx = 30;
        Console.WriteLine(v);
        var (dx, dy) = v;
        Console.WriteLine(dx - dy);
        var cash = new Money(5, "EUR");
        Console.WriteLine(cash);
        Console.WriteLine(cash == new Money(5, "EUR"));
        Console.WriteLine(cash.GetHashCode() == new Money(5, "EUR").GetHashCode());
        Console.WriteLine(default(Vector));

        // A generic record.
        var box = new Box<int>(7, "seven");
        var other = new Box<int>(7, "seven");
        Console.WriteLine(box);
        Console.WriteLine(box == other);
        other.Uses = 1;
        Console.WriteLine(box == other);
        Console.WriteLine(new Box<string>(null, "empty"));
        Console.WriteLine(new Box<Point>(p, "point") == new Box<Point>(q, "point"));

        // init accessors and required members.
        var options = new Options { Name = "o", Verbose = true };
        Console.WriteLine(options);
        Console.WriteLine(options with { Level = 5 });
        var account = new Account { Owner = "Ann", Balance = 10, Note = "x" };
        Console.WriteLine(account.Owner + account.Balance + account.Note);
    }
}
