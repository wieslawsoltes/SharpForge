using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

public readonly record struct Point(int X, int Y) : IComparable<Point>
{
    public static Point Origin => default;
    public int CompareTo(Point other) => X != other.X ? X.CompareTo(other.X) : Y.CompareTo(other.Y);
    public static Point operator +(Point point, Size size) => new(point.X + size.Width, point.Y + size.Height);
    public int DistanceSquared(Point other) => (X - other.X) * (X - other.X) + (Y - other.Y) * (Y - other.Y);
}

public record struct Size(int Width, int Height)
{
    public readonly int Area => Width * Height;
    public void Scale(int factor) { Width *= factor; Height *= factor; }
}

public record struct Bounds(Point Min, Point Max)
{
    public readonly Size Size => new(Max.X - Min.X, Max.Y - Min.Y);
    public readonly bool Contains(Point p) => p.X >= Min.X && p.X <= Max.X && p.Y >= Min.Y && p.Y <= Max.Y;
    public void Include(Point p)
    {
        Min = new Point(Math.Min(Min.X, p.X), Math.Min(Min.Y, p.Y));
        Max = Max with { X = Math.Max(Max.X, p.X), Y = Math.Max(Max.Y, p.Y) };
    }
}

public readonly record struct Angle
{
    public Angle(int degrees) { Degrees = degrees; }
    public int Degrees { get; }
    public int Normalized => (Degrees % 360 + 360) % 360;
    public bool Equals(Angle other) => Normalized == other.Normalized;
    public override int GetHashCode() => Normalized;
    private bool PrintMembers(StringBuilder builder)
    {
        builder.Append(Normalized).Append("deg");
        return true;
    }
}

public record struct Pair<T>(T First, T Second) where T : struct, IComparable<T>
{
    public readonly T Larger => First.CompareTo(Second) >= 0 ? First : Second;
    public readonly Pair<T> Swapped() => new(Second, First);
}

public interface IShape
{
    Bounds Box { get; }
    int TwiceArea { get; }
}

public abstract record Shape(string Label) : IShape
{
    public abstract Bounds Box { get; }
    public abstract int TwiceArea { get; }
}

public record Rectangle(string Label, Point Corner, Size Size) : Shape(Label)
{
    public override Bounds Box => new(Corner, Corner + Size);
    public override int TwiceArea => 2 * Size.Area;
}

public sealed record Triangle(string Label, Point A, Point B, Point C) : Shape(Label)
{
    public override Bounds Box
    {
        get
        {
            var box = new Bounds(A, A);
            box.Include(B);
            box.Include(C);
            return box;
        }
    }
    public override int TwiceArea => Math.Abs((B.X - A.X) * (C.Y - A.Y) - (C.X - A.X) * (B.Y - A.Y));
}

public sealed record Polyline(string Label, Point[] Points) : Shape(Label)
{
    public override Bounds Box => Points.Aggregate(new Bounds(Points[0], Points[0]), (box, p) => { box.Include(p); return box; });
    public override int TwiceArea => 0;
    protected override bool PrintMembers(StringBuilder builder)
    {
        builder.Append(Label).Append(": ").AppendJoin("->", Points.Select(p => $"({p.X},{p.Y})"));
        return true;
    }
}

public static class Program
{
    private static string Describe(IShape shape) => shape switch
    {
        Rectangle { Size: (var w, var h) } when w == h => "square " + w,
        Rectangle(_, (0, 0), var size) => "anchored rect " + size,
        Rectangle { Corner: var (x, y), Size.Area: > 20 } => $"big rect at {x},{y}",
        Triangle(_, var a, var b, var c) when a == b || b == c || a == c => "degenerate triangle",
        Triangle { TwiceArea: var twice } => "triangle " + twice / 2 + (twice % 2 == 1 ? ".5" : ""),
        Polyline { Points: [var first, .., var last] } when first == last => "closed polyline",
        Shape { Box.Size: { Width: 0 } or { Height: 0 } } => "flat " + shape.GetType().Name,
        _ => "shape",
    };

    public static void Main()
    {
        var p = new Point(3, 4);
        var size = new Size(2, 5);
        var moved = p + size;
        Console.WriteLine($"{p} {default(Point)} {Point.Origin == default} {moved} {p with { Y = -1 }} {p == new Point(3, 4)} {p != moved} {p.Equals((object)new Point(3, 4))} {p.DistanceSquared(moved)}");

        size.Width = 10;
        var copy = size;
        copy.Scale(3);
        var sizes = new[] { size, copy, default };
        sizes[0].Scale(2);
        sizes[2] = sizes[2] with { Height = 7 };
        var sizeList = new List<Size>(sizes);
        var fromList = sizeList[0];
        fromList.Height = 99;
        Console.WriteLine($"{size} {copy} {string.Join(" ", sizes)} {sizeList[0] == sizes[0]} {fromList.Area} {default(Size).Area} {size == copy with { Width = 10, Height = 5 }}");

        var box = new Bounds(p, p);
        foreach (var extra in new[] { new Point(-2, 9), new Point(6, 0), moved }) box.Include(extra);
        var widened = box with { Min = box.Min with { X = -10 } };
        var (min, max) = box;
        var (minX, minY) = min;
        Console.WriteLine($"{box} {box.Size} {box.Contains(p)} {box.Contains(new Point(7, 1))} {widened.Size.Area} {minX}/{minY}/{max.X} {default(Bounds) == new Bounds(Point.Origin, default)}");

        var angles = new[] { new Angle(90), new Angle(450), new Angle(-270), new Angle(91), new Angle(0), new Angle(-360), default };
        var distinct = new HashSet<Angle>(angles);
        Console.WriteLine($"{angles[1]} {angles[2].Degrees} {angles[0] == angles[1]} {angles[0].Equals(angles[2])} {angles[0] != angles[3]} {distinct.Count} {string.Join(",", distinct.Select(a => a.Normalized).OrderBy(n => n))}");

        var pair = new Pair<Point>(moved, p);
        var ints = new Pair<int>(4, 9) with { First = 12 };
        ints.Second += 100;
        Console.WriteLine($"{pair.Larger} {pair.Swapped() == new Pair<Point>(p, moved)} {ints} {ints.Larger} {ints.Swapped().Swapped() == ints} {new Pair<Point>().First} {default(Pair<long>)}");

        Shape[] shapes =
        {
            new Rectangle("r1", new Point(1, 1), new Size(4, 4)), new Rectangle("r2", Point.Origin, new Size(2, 3)), new Rectangle("r3", new Point(5, 5), new Size(7, 3)),
            new Rectangle("r4", new Point(5, 5), new Size(0, 3)), new Triangle("t1", new Point(0, 0), new Point(4, 0), new Point(0, 3)),
            new Triangle("t2", new Point(0, 0), new Point(1, 0), new Point(0, 1)), new Triangle("t3", p, p, moved),
            new Polyline("l1", new[] { p, moved, new Point(0, 0), p }), new Polyline("l2", new[] { new Point(1, 2), new Point(5, 2) }), new Polyline("l3", new[] { p, moved }),
        };
        foreach (var shape in shapes) Console.WriteLine($"{Describe(shape),-22} {shape.TwiceArea,3} {shape.Box.Size.Area,3}  {shape}");

        var byPoint = new Dictionary<Point, string>();
        foreach (var shape in shapes) byPoint[shape.Box.Min] = byPoint.TryGetValue(shape.Box.Min, out var labels) ? labels + "+" + shape.Label : shape.Label;
        Console.WriteLine(string.Join(" ", byPoint.OrderBy(entry => entry.Key).Select(entry => $"({entry.Key.X},{entry.Key.Y})={entry.Value}")));
        var r1 = (Rectangle)shapes[0];
        Shape resized = r1 with { Size = r1.Size with { Width = 9 } };
        var points = (Polyline)shapes[7];
        Console.WriteLine($"{resized} {r1 == resized} {r1 == r1 with { Label = "r1" }} {points == points with { }} {points == points with { Points = points.Points.ToArray() }} {shapes.Max(s => s.Box.Max)} {shapes.Min(s => s.Box.Min)}");
    }
}
