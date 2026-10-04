using System;

public readonly struct Vec2
{
    public readonly double X, Y;
    public Vec2(double x, double y) { X = x; Y = y; }
    public static implicit operator Vec2((double X, double Y) tuple) => new Vec2(tuple.X, tuple.Y);
    public static explicit operator (int, int)(Vec2 v) => ((int)v.X, (int)v.Y);
    public static Vec2 operator +(in Vec2 a, in Vec2 b) => new Vec2(a.X + b.X, a.Y + b.Y);
    public static Vec2 operator -(in Vec2 a) => new Vec2(-a.X, -a.Y);
    public static bool operator ==(in Vec2 a, in Vec2 b) => a.X == b.X && a.Y == b.Y;
    public static bool operator !=(in Vec2 a, in Vec2 b) => !(a == b);
    public override bool Equals(object obj) => obj is Vec2 v && this == v;
    public override int GetHashCode() => 0;
    public override string ToString() => "<" + X + "," + Y + ">";
}

public struct Matrix2
{
    public double M11, M12, M21, M22;
    public Matrix2(double m11, double m12, double m21, double m22) { M11 = m11; M12 = m12; M21 = m21; M22 = m22; }
    public static Matrix2 Identity => new Matrix2(1, 0, 0, 1);
    public readonly double Determinant => M11 * M22 - M12 * M21;
    public static Matrix2 operator *(in Matrix2 a, in Matrix2 b) => new Matrix2(
        a.M11 * b.M11 + a.M12 * b.M21, a.M11 * b.M12 + a.M12 * b.M22,
        a.M21 * b.M11 + a.M22 * b.M21, a.M21 * b.M12 + a.M22 * b.M22);
    public static Vec2 operator *(in Matrix2 m, Vec2 v) => new Vec2(m.M11 * v.X + m.M12 * v.Y, m.M21 * v.X + m.M22 * v.Y);
    public override string ToString() => "[" + M11 + " " + M12 + "; " + M21 + " " + M22 + "]";
}

public static class Program
{
    static Vec2 Sum(params Vec2[] values)
    {
        Vec2 total = (0, 0);
        foreach (var value in values) total += value;
        return total;
    }

    public static void Main()
    {
        var m = new Matrix2(1, 2, 3, 4);
        var rotate = new Matrix2(0, -1, 1, 0);
        Matrix2[] array = { m, rotate };
        Console.WriteLine(m * rotate + " " + rotate * rotate + " " + (m * Matrix2.Identity).Determinant + " " + rotate * new Vec2(1, 0) + " " + array[0] * array[1] * array[1]);
        Vec2 a = (1.5, -2), b = (1, 2);
        int whole = 3;
        Vec2 c = (whole, whole * 2);
        (int, int) cut = ((int, int))a;
        Console.WriteLine(a + " " + b + " " + c + " " + (a + b) + " " + -a + " " + (a == b) + " " + (a + b != a) + " " + cut + " " + Sum(a, b, (10, 20)) + " " + Sum());
    }
}
