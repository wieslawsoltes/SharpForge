using System;
using System.Globalization;

public readonly struct Vec2 : IEquatable<Vec2>
{
    public readonly double X, Y;
    public Vec2(double x, double y) { X = x; Y = y; }
    public static readonly Vec2 Zero = default;
    public static Vec2 UnitX => new Vec2(1, 0);
    public double Length => Math.Sqrt(X * X + Y * Y);
    public static Vec2 operator +(Vec2 a, Vec2 b) => new Vec2(a.X + b.X, a.Y + b.Y);
    public static Vec2 operator -(Vec2 a, Vec2 b) => new Vec2(a.X - b.X, a.Y - b.Y);
    public static Vec2 operator -(Vec2 a) => new Vec2(-a.X, -a.Y);
    public static Vec2 operator *(Vec2 a, double k) => new Vec2(a.X * k, a.Y * k);
    public static Vec2 operator *(double k, Vec2 a) => a * k;
    public static double operator *(Vec2 a, Vec2 b) => a.X * b.X + a.Y * b.Y;
    public static bool operator ==(Vec2 a, Vec2 b) => a.Equals(b);
    public static bool operator !=(Vec2 a, Vec2 b) => !a.Equals(b);
    public static implicit operator Vec2((double X, double Y) tuple) => new Vec2(tuple.X, tuple.Y);
    public static explicit operator double(Vec2 v) => v.Length;
    public bool Equals(Vec2 other) => X == other.X && Y == other.Y;
    public override bool Equals(object obj) => obj is Vec2 v && Equals(v);
    public override int GetHashCode() => X.GetHashCode() ^ Y.GetHashCode();
    public void Deconstruct(out double x, out double y) { x = X; y = Y; }
    public override string ToString() => string.Format(CultureInfo.InvariantCulture, "<{0:0.##}, {1:0.##}>", X, Y);
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
    public void Transpose() { (M12, M21) = (M21, M12); }
    public double this[int row, int column]
    {
        readonly get => (row * 2 + column) switch { 0 => M11, 1 => M12, 2 => M21, 3 => M22, _ => throw new IndexOutOfRangeException() };
        set
        {
            switch (row * 2 + column)
            {
                case 0: M11 = value; break;
                case 1: M12 = value; break;
                case 2: M21 = value; break;
                case 3: M22 = value; break;
                default: throw new IndexOutOfRangeException();
            }
        }
    }
    public readonly override string ToString() => FormattableString.Invariant($"[{M11:0.##} {M12:0.##}; {M21:0.##} {M22:0.##}]");
}

public ref struct Accumulator
{
    private Span<double> values;
    private int count;
    public Accumulator(Span<double> storage) { values = storage; count = 0; }
    public void Add(double value) { values[count++] = value; }
    public readonly double Total
    {
        get
        {
            double total = 0;
            for (int i = 0; i < count; i++) total += values[i];
            return total;
        }
    }
    public readonly ReadOnlySpan<double> Filled => values.Slice(0, count);
}

public static class Program
{
    private static void Swap<T>(ref T left, ref T right) { T temporary = left; left = right; right = temporary; }

    private static bool TryNormalize(in Vec2 vector, out Vec2 unit)
    {
        double length = vector.Length;
        if (length == 0) { unit = default; return false; }
        unit = vector * (1 / length);
        return true;
    }

    private static ref double Largest(ref Matrix2 matrix)
    {
        ref double best = ref matrix.M11;
        if (matrix.M12 > best) best = ref matrix.M12;
        if (matrix.M21 > best) best = ref matrix.M21;
        if (matrix.M22 > best) best = ref matrix.M22;
        return ref best;
    }

    private static void Mutate(Matrix2 copy, ref Matrix2 reference)
    {
        copy.M11 = 100;
        reference.M11 += 100;
    }

    private static double SumAll(in Matrix2 m) => m.M11 + m.M12 + m.M21 + m.M22;

    public static void Main()
    {
        Vec2 a = new Vec2(3, 4), b = (1.5, -2);
        Console.WriteLine($"{a} {b} {a + b} {a - b} {-a} {a * 2} {0.5 * b} {a * b} {(double)a} {a.Length}");
        Console.WriteLine((a == new Vec2(3, 4)) + " " + (a != b) + " " + a.Equals((object)b) + " " + (Vec2.Zero == default(Vec2)) + " " + Vec2.UnitX);
        var (x, y) = a + Vec2.UnitX;
        Console.WriteLine(x + y);
        Swap(ref a, ref b);
        Console.WriteLine(a + " " + b);
        Console.WriteLine(TryNormalize(b, out var unit) + " " + unit + " " + TryNormalize(Vec2.Zero, out var none) + " " + none);

        var m = new Matrix2(1, 2, 3, 4);
        var rotate = new Matrix2(0, -1, 1, 0);
        Console.WriteLine(m * rotate + " " + rotate * rotate + " " + (m * Matrix2.Identity).Determinant + " " + rotate * new Vec2(1, 0));
        m.Transpose();
        m[0, 0] = 9;
        m[1, 1] *= 2;
        ref double cell = ref m.M12;
        cell += 0.5;
        m[1, 0]++;
        Console.WriteLine(m + " " + m.Determinant.ToString(CultureInfo.InvariantCulture));
        Largest(ref m) = -1;
        ref double largest = ref Largest(ref m);
        largest++;
        Console.WriteLine(m + " " + SumAll(m).ToString(CultureInfo.InvariantCulture));
        var copy = m;
        Mutate(copy, ref m);
        Console.WriteLine(copy.M11 + " " + m.M11);
        Matrix2[] array = { m, copy };
        array[1].M22 = 7;
        ref Matrix2 first = ref array[0];
        first.Transpose();
        foreach (ref readonly var item in array.AsSpan()) Console.Write(item + " ");
        Console.WriteLine();
        try { Console.WriteLine(m[2, 2]); } catch (IndexOutOfRangeException) { Console.WriteLine("out of range"); }

        Span<double> storage = stackalloc double[8];
        var accumulator = new Accumulator(storage);
        for (int i = 1; i <= 5; i++) accumulator.Add(i * 1.5);
        Console.WriteLine(accumulator.Total.ToString(CultureInfo.InvariantCulture) + " " + accumulator.Filled.Length + " " + storage[4].ToString(CultureInfo.InvariantCulture) + " " + storage[5]);
        object boxed = a;
        Vec2 unboxed = (Vec2)boxed;
        Vec2? maybe = null;
        Console.WriteLine(unboxed + " " + boxed.Equals(a) + " " + (maybe ?? Vec2.UnitX) + " " + (maybe == null) + " " + ((maybe = b) == b) + " " + maybe.Value.X);
    }
}
