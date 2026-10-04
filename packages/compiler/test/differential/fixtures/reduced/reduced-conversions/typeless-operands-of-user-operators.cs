using System;
using System.Collections.Generic;

// Reduced from stress-records/geometry-values: `default` (and `null`, `new()`) as an operand of a user-defined operator
// takes the type of the operator's parameter - `point == default` passed a null reference for the struct.
public readonly record struct Point(int X, int Y)
{
    public static readonly Point Origin = default;
}
public record struct Size(int Width, int Height)
{
    public readonly int Area => Width * Height;
    public void Scale(int factor) { Width *= factor; Height *= factor; }
}
public record struct Bounds(Point Min, Point Max);
public readonly record struct Pair<T>(T First, T Second) where T : struct;

public static class Program
{
    static void A()
    {
        var p = new Point(3, 4);
        Console.WriteLine($"{p with { Y = -1 }}");
    }
    static void A2() { Console.WriteLine($"{default(Point)}"); }
    static void A3() { Console.WriteLine($"{Point.Origin == default}"); }
    static void A4() { var p = new Point(3, 4); Point? none = null; Console.WriteLine(p == new Point(3, 4)); Console.WriteLine(p != default); Console.WriteLine(p == new() { X = 3, Y = 4 }); Console.WriteLine(none == null); }
    static void B()
    {
        var size = new Size(2, 5);
        var copy = size;
        var sizes = new[] { size, copy, default };
        sizes[0].Scale(2);
        sizes[2] = sizes[2] with { Height = 7 };
        Console.WriteLine($"{string.Join(" ", sizes)} {size == copy with { Width = 10, Height = 5 }}");
    }
    static void C()
    {
        var p = new Point(1, 2);
        var box = new Bounds(p, p);
        var widened = box with { Min = box.Min with { X = -10 } };
        var (min, max) = box;
        var (minX, minY) = min;
        Console.WriteLine($"{widened} {minX} {minY} {max} {default(Bounds) == new Bounds(Point.Origin, default)}");
    }
    static void D()
    {
        var ints = new Pair<int>(4, 9) with { First = 12 };
        var list = new List<Size> { new Size(1, 2) };
        var fromList = list[0];
        fromList.Height = 99;
        Console.WriteLine($"{ints} {fromList} {list[0] with { Width = 5 }}");
    }
    public static void Main()
    {
        foreach (Action step in new Action[] { A, A2, A3, A4, B, C, D })
        {
            step();
        }
    }
}
