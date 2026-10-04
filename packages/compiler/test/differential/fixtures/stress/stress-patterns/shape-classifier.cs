using System;
using System.Collections.Generic;
using System.Globalization;

public readonly struct Vec
{
    public Vec(double x, double y) { X = x; Y = y; }
    public double X { get; }
    public double Y { get; }
    public void Deconstruct(out double x, out double y) { x = X; y = Y; }
    public override string ToString() => "(" + X.ToString(CultureInfo.InvariantCulture) + "," + Y.ToString(CultureInfo.InvariantCulture) + ")";
}

public enum Fill { None, Solid, Hatched }

public interface IShape { Fill Fill { get; } }
public readonly struct Marker : IShape { public Fill Fill => Fill.Hatched; }
public abstract class Shape : IShape
{
    public Fill Fill { get; set; }
    public Vec Origin { get; set; }
}
public class Circle : Shape
{
    public double Radius { get; set; }
    public void Deconstruct(out Vec center, out double radius) { center = Origin; radius = Radius; }
}
public class Rect : Shape
{
    public double Width { get; set; }
    public double Height { get; set; }
    public void Deconstruct(out double width, out double height) { width = Width; height = Height; }
}
public sealed class Square : Rect { }
public class Polygon : Shape { public Vec[] Points { get; set; } }
public class Group : Shape
{
    public List<Shape> Children { get; } = new List<Shape>();
    public Vec? Anchor { get; set; }
}

public static class Program
{
    private static string F(double value) => value.ToString("0.##", CultureInfo.InvariantCulture);

    private static string Classify(IShape shape) => shape switch
    {
        null => "nothing",
        Circle { Radius: <= 0 } => "degenerate circle",
        Circle((0, 0), 1) => "unit circle",
        Circle { Radius: > 0 and < 1 } => "small circle",
        Circle { Origin: { X: < 0 } or { Y: < 0 }, Radius: var r } => "off-quadrant circle r=" + F(r),
        Circle(var (cx, cy), var r) => $"circle at {F(cx)},{F(cy)} area {F(Math.PI * r * r)}",
        Square { Width: var side } => "square " + F(side * side),
        Rect(var w, var h) when w == h => "square-like rect " + F(w),
        Rect(> 100, _) or Rect(_, > 100) => "huge rect",
        Rect { Width: > 0, Height: > 0 } rect and not { Fill: Fill.None } => "filled rect " + F(rect.Width * rect.Height),
        Rect => "plain rect",
        Polygon { Points: null or [] } => "empty polygon",
        Polygon { Points: [var a, var b, var c] } => "triangle area " + F(Math.Abs((b.X - a.X) * (c.Y - a.Y) - (c.X - a.X) * (b.Y - a.Y)) / 2),
        Polygon { Points: [(0, 0), .. var middle, (0, 0)] } => "closed at origin via " + middle.Length,
        Polygon { Points.Length: var n and (4 or 5) } => "small " + n + "-gon",
        Polygon { Points: [.., { X: var lastX }] } => "polygon ending x=" + F(lastX),
        Group { Anchor: null, Children.Count: 0 } => "empty group",
        Group { Anchor: (var ax, var ay) } => "anchored group " + F(ax + ay),
        Group { Children: [Circle, .., Circle] } => "circle-bounded group",
        Group { Children: [Rect { Fill: Fill.Solid or Fill.Hatched } first, ..] } => "group led by filled rect " + F(first.Width),
        Group { Children.Count: var count } => "group of " + count,
        _ => "unknown " + shape.Fill,
    };

    private static int Corners(Shape shape)
    {
        switch (shape)
        {
            case Circle:
            case Group { Children.Count: 0 }:
                return 0;
            case Square:
            case Rect { Width: > 0 } when shape.Fill != Fill.None:
                return 4;
            case Rect r when r.Width * r.Height == 0:
                return 2;
            case Rect:
                return -4;
            case Polygon { Points: { Length: var n } }:
                return n;
            case Group g:
                int sum = 0;
                foreach (var child in g.Children) sum += Corners(child);
                return sum;
            default:
                return -1;
        }
    }

    private static string Paint(Fill fill, bool selected, Vec? offset) => (fill, selected, offset) switch
    {
        (Fill.None, false, null) => "skip",
        (Fill.None, true, _) => "outline",
        (Fill.Solid or Fill.Hatched, _, { X: 0, Y: 0 }) => "fill in place",
        (var f, true, (var dx, var dy)) => $"{f} selected shifted {F(dx)},{F(dy)}",
        (not Fill.None, false, Vec v) => "shifted " + v,
        (_, _, null) => "fill",
        _ => "outline shifted",
    };

    private static string Kind<T>(T value) => value switch
    {
        Shape s when s is IShape { Fill: Fill.Solid } => "solid " + s.GetType().Name,
        Shape => "shape",
        Vec(var x, var y) when x == y => "diagonal vec",
        Vec or Marker => "struct " + typeof(T).Name,
        int n and (< 0 or > 9) => "wide int " + n,
        int => "digit",
        null => "null " + typeof(T).Name,
        _ => "other",
    };

    private static bool TryAs<T>(object candidate, out T result)
    {
        if (candidate is T typed) { result = typed; return true; }
        result = default;
        return false;
    }

    public static void Main()
    {
        var anchored = new Group { Anchor = new Vec(2, 3) };
        var circles = new Group { Children = { new Circle { Radius = 1 }, new Rect { Width = 2, Height = 5 }, new Circle { Radius = 2 } } };
        var led = new Group { Children = { new Rect { Width = 7, Height = 1, Fill = Fill.Hatched }, new Square { Width = 2, Height = 2, Fill = Fill.Solid } } };
        var mixed = new Group { Children = { new Polygon { Points = new[] { new Vec(0, 0), new Vec(1, 0), new Vec(1, 1), new Vec(0, 1) } }, led, new Rect() } };
        IShape[] shapes =
        {
            null, new Circle { Radius = 0 }, new Circle { Radius = 1 }, new Circle { Radius = 0.5, Origin = new Vec(4, 4) },
            new Circle { Radius = 3, Origin = new Vec(-1, 2) }, new Circle { Radius = 2, Origin = new Vec(1, 2) },
            new Square { Width = 3, Height = 3 }, new Rect { Width = 4, Height = 4 }, new Rect { Width = 150, Height = 2 },
            new Rect { Width = 2, Height = 3, Fill = Fill.Solid }, new Rect { Width = 2, Height = 3 }, new Polygon(),
            new Polygon { Points = new[] { new Vec(0, 0), new Vec(4, 0), new Vec(0, 3) } },
            new Polygon { Points = new[] { new Vec(0, 0), new Vec(4, 0), new Vec(4, 4), new Vec(0, 4), new Vec(-1, 2), new Vec(0, 0) } },
            ((Polygon)mixed.Children[0]), new Polygon { Points = new[] { new Vec(1, 1), new Vec(7.5, 2) } },
            new Group(), anchored, circles, led, mixed, new Marker(),
        };
        foreach (var shape in shapes) Console.WriteLine(Classify(shape));

        var corners = new List<int>();
        foreach (var shape in shapes) if (shape is Shape real) corners.Add(Corners(real));
        Console.WriteLine("corners " + string.Join(",", corners));

        Vec? none = null, zero = new Vec(0, 0), moved = new Vec(1.5, -2);
        Console.WriteLine(string.Join("; ", Paint(Fill.None, false, none), Paint(Fill.None, true, moved), Paint(Fill.Solid, true, zero),
            Paint(Fill.Hatched, true, moved), Paint(Fill.Solid, false, moved), Paint(Fill.Hatched, false, none), Paint(Fill.None, false, zero)));
        Console.WriteLine(string.Join("; ", Kind(shapes[9]), Kind<Shape>(null), Kind(shapes[6]), Kind(new Vec(2, 2)), Kind(new Vec(1, 2)),
            Kind(new Marker()), Kind(42), Kind(7), Kind<int?>(null), Kind("text"), Kind<object>(-3)));
        Console.WriteLine(TryAs<Rect>(shapes[6], out var asRect) + " " + asRect.Width + " " + TryAs<Circle>(shapes[6], out var asCircle) + " " + (asCircle is null)
            + " " + TryAs<int>(5L, out var asInt) + asInt + " " + TryAs<IShape>(new Marker(), out var marker) + marker.Fill);

        var describers = new List<Func<string>>();
        foreach (var shape in shapes)
        {
            if (shape is not Shape { Origin: var origin } known) continue;
            if (known is Circle { Radius: var radius } && radius > 1 || known is Rect { Width: > 100 })
                describers.Add(() => known.GetType().Name + "@" + origin);
            if (!(known is Polygon { Points: { Length: > 3 } points })) continue;
            describers.Add(() => "poly " + points.Length + " from " + points[0] + " to " + points[^1]);
        }
        foreach (var describe in describers) Console.WriteLine(describe());
        Vec? probe = moved;
        Console.WriteLine((probe is { X: > 1 } hit ? hit.Y : 0).ToString(CultureInfo.InvariantCulture) + " " + (none is null) + " " + (zero is (0, 0)) + " " + (probe is not (_, >= 0)));
    }
}
