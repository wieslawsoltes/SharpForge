using System;
using Imported;

// Source types that override and implement members of Library.dll whose signatures carry custom modifiers. The
// runtime matches an override by name and signature, modifiers included: without them `Square` would not implement
// the abstract members of `Shape` (TypeLoadException) and the library would not reach these methods.

class Square : Shape
{
    int corner = 4;
    public override int Area(in int scale) { return scale * scale; }
    public override ref readonly int Corner { get { return ref corner; } }
    public override int Size { get; init; }
    public override string Describe(in long first, ref int second, out int third) { third = second * 10; second++; return "Square:" + first; }
}

class Cube : Square
{
    public override int Area(in int scale) { return base.Area(in scale) * scale; }
}

class Ruler : IMeasure
{
    int origin = 1;
    public int Measure(in int unit) { return unit * 2; }
    public ref readonly int Origin { get { return ref origin; } }
    public int Tag { get; init; }
}

class ExplicitRuler : IMeasure
{
    int origin = 5;
    int IMeasure.Measure(in int unit) { return unit * 3; }
    ref readonly int IMeasure.Origin { get { return ref origin; } }
    int IMeasure.Tag { get { return 8; } init { } }
}

class Larger : Source<int>
{
    public override int Pick(in int first, in int second) { return first > second ? first : second; }
}

class Longer<T> : Source<T[]>
{
    public override T[] Pick(in T[] first, in T[] second) { return first.Length >= second.Length ? first : second; }
}

static class Program
{
    static void Main()
    {
        Console.WriteLine(new Square { Size = 6 }.Report(3));
        Console.WriteLine(new Cube { Size = 7 }.Report(2));
        Console.WriteLine(Measures.Report(new Ruler { Tag = 9 }));
        Console.WriteLine(Measures.Report(new ExplicitRuler()));
        Console.WriteLine(new Larger().First(3, 8) + " " + new Longer<string>().First(new[] { "a" }, new[] { "b", "c" }).Length);
        Shape shape = new Square { Size = 1 };
        int scale = 5, second = 1;
        Console.WriteLine(shape.Area(in scale) + " " + shape.Describe(2L, ref second, out var third) + " " + second + " " + third + " " + shape.Corner);
    }
}
