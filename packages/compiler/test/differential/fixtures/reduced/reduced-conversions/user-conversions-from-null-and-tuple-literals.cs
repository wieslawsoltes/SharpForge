using System;

// Reduced from stress-operators/vector-units-algebra and stress-operators/tristate-access-policy: an expression
// without a fixed type (a tuple literal, `null`) converts through an implicit operator of the target type - in
// declarations, arguments and operands of user-defined operators.

public readonly struct Vec2 : IEquatable<Vec2>
{
    public Vec2(double x, double y) { X = x; Y = y; }
    public double X { get; }
    public double Y { get; }
    public static implicit operator Vec2((double X, double Y) tuple) => new Vec2(tuple.X, tuple.Y);
    public static Vec2 operator +(Vec2 a, Vec2 b) => new Vec2(a.X + b.X, a.Y + b.Y);
    public static bool operator ==(Vec2 a, Vec2 b) => a.Equals(b);
    public static bool operator !=(Vec2 a, Vec2 b) => !a.Equals(b);
    public bool Equals(Vec2 other) => X == other.X && Y == other.Y;
    public override bool Equals(object obj) => obj is Vec2 other && Equals(other);
    public override int GetHashCode() => 0;
    public override string ToString() => "<" + X + "," + Y + ">";
}

// A tri-state value with user-defined conversions from bool and bool?: `null` converts through the operator.
public readonly struct Tri
{
    private readonly sbyte state;
    private Tri(sbyte state) { this.state = state; }
    public static readonly Tri Unknown = new Tri(0);
    public static implicit operator Tri(bool value) => new Tri(value ? (sbyte)1 : (sbyte)-1);
    public static implicit operator Tri(bool? value) => value.HasValue ? value.Value : Unknown;
    public override string ToString() => state > 0 ? "yes" : state < 0 ? "no" : "unknown";
}

public static class Program
{
    private static string Show(Vec2 value) => value.ToString();
    private static string Show(Tri value) => value.ToString();

    public static void Main()
    {
        Vec2 v = (3.0, 4.0);
        Console.WriteLine(v + " " + Show((1, 2)) + " " + (v == (3.0, 4.0)) + " " + (v != (3, 4)) + " " + ((1.5, 2.5) == v) + " " + (v + (1, 1)));
        Tri yes = true, maybe = (bool?)null, fromNull = null;
        Console.WriteLine(yes + " " + maybe + " " + fromNull + " " + Show(null) + " " + Show(false));
    }
}
