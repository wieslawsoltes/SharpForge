using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Numerics;

public static class Fmt
{
    public static string F(double value) => (Math.Round(value, 3) + 0.0).ToString("0.###", CultureInfo.InvariantCulture);
    public static string Kind<T>(T value) => typeof(T).Name.Split('`')[0];
}

public interface IUnit { static abstract string Symbol { get; } static abstract double ToMeters { get; } }
public readonly struct Meters : IUnit { public static string Symbol => "m"; public static double ToMeters => 1; }
public readonly struct Feet : IUnit { public static string Symbol => "ft"; public static double ToMeters => 0.3048; }
public readonly struct Kilometers : IUnit { public static string Symbol => "km"; public static double ToMeters => 1000; }
public interface IScalable<TSelf> where TSelf : IScalable<TSelf> { static abstract TSelf operator *(TSelf value, double factor); }

public readonly struct Length<TUnit> : IAdditionOperators<Length<TUnit>, Length<TUnit>, Length<TUnit>>, IAdditiveIdentity<Length<TUnit>, Length<TUnit>>, IScalable<Length<TUnit>>, IComparable<Length<TUnit>>
    where TUnit : IUnit
{
    public Length(double value) { Value = value; }
    public double Value { get; }
    public static Length<TUnit> AdditiveIdentity => default;
    public Length<TOther> To<TOther>() where TOther : IUnit => new Length<TOther>(Value * TUnit.ToMeters / TOther.ToMeters);
    public static implicit operator Length<TUnit>(double value) => new Length<TUnit>(value);
    public static explicit operator double(Length<TUnit> length) => length.Value * TUnit.ToMeters;
    public static Length<TUnit> operator +(Length<TUnit> a, Length<TUnit> b) => new Length<TUnit>(a.Value + b.Value);
    public static Length<TUnit> operator -(Length<TUnit> a, Length<TUnit> b) => new Length<TUnit>(a.Value - b.Value);
    public static Length<TUnit> operator -(Length<TUnit> a) => new Length<TUnit>(-a.Value);
    public static Length<TUnit> operator *(Length<TUnit> a, double factor) => new Length<TUnit>(a.Value * factor);
    public static Length<TUnit> operator *(double factor, Length<TUnit> a) => new Length<TUnit>(a.Value * factor);
    public static Area operator *(Length<TUnit> a, Length<TUnit> b) => new Area((double)a * (double)b);
    public static double operator /(Length<TUnit> a, Length<TUnit> b) => a.Value / b.Value;
    public static Length<TUnit> operator /(Length<TUnit> a, double divisor) => new Length<TUnit>(a.Value / divisor);
    public static Speed operator /(Length<TUnit> distance, TimeSpan time) => new Speed((double)distance / time.TotalSeconds);
    public static bool operator <(Length<TUnit> a, Length<TUnit> b) => a.Value < b.Value;
    public static bool operator >(Length<TUnit> a, Length<TUnit> b) => a.Value > b.Value;
    public int CompareTo(Length<TUnit> other) => Value.CompareTo(other.Value);
    public override string ToString() => Fmt.F(Value) + TUnit.Symbol;
}

public readonly record struct Area(double SquareMeters)
{
    public static Length<Meters> operator /(Area area, Length<Meters> side) => new Length<Meters>(area.SquareMeters / side.Value);
    public static Area operator +(Area a, Area b) => new Area(a.SquareMeters + b.SquareMeters);
    public override string ToString() => Fmt.F(SquareMeters) + "m2";
}

public readonly record struct Speed(double MetersPerSecond)
{
    public static Length<Meters> operator *(Speed speed, TimeSpan time) => new Length<Meters>(speed.MetersPerSecond * time.TotalSeconds);
    public static Length<Meters> operator *(TimeSpan time, Speed speed) => speed * time;
    public override string ToString() => Fmt.F(MetersPerSecond * 3.6) + "km/h";
}

public readonly struct Vec2 : IAdditionOperators<Vec2, Vec2, Vec2>, IAdditiveIdentity<Vec2, Vec2>, IScalable<Vec2>, IEquatable<Vec2>
{
    public Vec2(double x, double y) { X = x; Y = y; }
    public double X { get; }
    public double Y { get; }
    public static Vec2 AdditiveIdentity => default;
    public void Deconstruct(out double x, out double y) { x = X; y = Y; }
    public static implicit operator Vec2((double X, double Y) tuple) => new Vec2(tuple.X, tuple.Y);
    public static explicit operator double(Vec2 v) => Math.Sqrt(v * v);
    public static Vec2 operator +(Vec2 a, Vec2 b) => new Vec2(a.X + b.X, a.Y + b.Y);
    public static Vec2 operator -(Vec2 a, Vec2 b) => new Vec2(a.X - b.X, a.Y - b.Y);
    public static Vec2 operator -(Vec2 a) => new Vec2(-a.X, -a.Y);
    public static Vec2 operator *(Vec2 a, double k) => new Vec2(a.X * k, a.Y * k);
    public static Vec2 operator *(double k, Vec2 a) => new Vec2(a.X * k, a.Y * k);
    public static double operator *(Vec2 a, Vec2 b) => a.X * b.X + a.Y * b.Y;
    public static double operator ^(Vec2 a, Vec2 b) => a.X * b.Y - a.Y * b.X;
    public static Vec2 operator /(Vec2 a, double k) => new Vec2(a.X / k, a.Y / k);
    public static bool operator ==(Vec2 a, Vec2 b) => a.Equals(b);
    public static bool operator !=(Vec2 a, Vec2 b) => !a.Equals(b);
    public bool Equals(Vec2 other) => Math.Abs(X - other.X) < 1e-9 && Math.Abs(Y - other.Y) < 1e-9;
    public override bool Equals(object obj) => obj is Vec2 other && Equals(other);
    public override int GetHashCode() => 0;
    public override string ToString() => "(" + Fmt.F(X) + "," + Fmt.F(Y) + ")";
}

public readonly struct Mat2
{
    private readonly double a, b, c, d;
    public Mat2(double a, double b, double c, double d) { this.a = a; this.b = b; this.c = c; this.d = d; }
    public static readonly Mat2 Identity = new Mat2(1, 0, 0, 1);
    public static Mat2 Rotation(int quarterTurns) => quarterTurns % 4 == 0 ? Identity : new Mat2(0, -1, 1, 0) * Rotation(quarterTurns - 1);
    public double this[int row, int column] => (row, column) switch { (0, 0) => a, (0, 1) => b, (1, 0) => c, (1, 1) => d, _ => throw new IndexOutOfRangeException() };
    public double Determinant => a * d - b * c;
    public static Mat2 operator *(Mat2 m, Mat2 n) => new Mat2(m.a * n.a + m.b * n.c, m.a * n.b + m.b * n.d, m.c * n.a + m.d * n.c, m.c * n.b + m.d * n.d);
    public static Vec2 operator *(Mat2 m, Vec2 v) => new Vec2(m.a * v.X + m.b * v.Y, m.c * v.X + m.d * v.Y);
    public static Mat2 operator *(Mat2 m, double k) => new Mat2(m.a * k, m.b * k, m.c * k, m.d * k);
    public static Mat2 operator +(Mat2 m, Mat2 n) => new Mat2(m.a + n.a, m.b + n.b, m.c + n.c, m.d + n.d);
    public static Mat2 operator -(Mat2 m) => m * -1;
    public static Mat2 operator ~(Mat2 m) => new Mat2(m.a, m.c, m.b, m.d);
    public static Mat2 operator !(Mat2 m) => new Mat2(m.d, -m.b, -m.c, m.a) * (1 / m.Determinant);
    public static Mat2 operator <<(Mat2 m, int turns) => Rotation(turns) * m;
    public static Mat2 operator >>(Mat2 m, int turns) => Rotation(4 - turns % 4) * m;
    public override string ToString() => "[" + Fmt.F(a) + " " + Fmt.F(b) + "; " + Fmt.F(c) + " " + Fmt.F(d) + "]";
}

public readonly struct Fixed : IComparable<Fixed>
{
    private readonly int raw; // Q16.16
    private Fixed(int raw) { this.raw = raw; }
    public static implicit operator Fixed(int whole) => new Fixed(whole << 16);
    public static explicit operator Fixed(double value) => new Fixed((int)Math.Round(value * 65536));
    public static explicit operator double(Fixed value) => value.raw / 65536.0;
    public static Fixed operator +(Fixed a, Fixed b) => new Fixed(a.raw + b.raw);
    public static Fixed operator *(Fixed a, Fixed b) => new Fixed((int)((long)a.raw * b.raw >> 16));
    public static Fixed operator /(Fixed a, Fixed b) => new Fixed((int)(((long)a.raw << 16) / b.raw));
    public static Fixed operator <<(Fixed a, int bits) => new Fixed(a.raw << bits);
    public static Fixed operator >>(Fixed a, int bits) => new Fixed(a.raw >> bits);
    public static Fixed operator >>>(Fixed a, int bits) => new Fixed(a.raw >>> bits);
    public static Fixed operator ++(Fixed a) => new Fixed(a.raw + 65536);
    public static Fixed operator --(Fixed a) => new Fixed(a.raw - 65536);
    public int CompareTo(Fixed other) => raw.CompareTo(other.raw);
    public override string ToString() => Fmt.F((double)this);
}

public sealed class Odometer
{
    public Length<Meters> Total { get; private set; }
    public int Legs { get; private set; }
    public string Units { get; private set; } = "";
    public void operator +=(Length<Meters> leg) { Total += leg; Units += "m"; }
    public void operator +=(Length<Feet> leg) { Total += leg.To<Meters>(); Units += "f"; }
    public void operator +=(Length<Kilometers> leg) { Total += leg.To<Meters>(); Units += "k"; }
    public void operator -=(double meters) { Total -= meters; Units += "-"; }
    public void operator ++() => Legs++;
}

public static class Geometry
{
    public static T Sum<T>(IEnumerable<T> items) where T : IAdditionOperators<T, T, T>, IAdditiveIdentity<T, T> => items.Aggregate(T.AdditiveIdentity, (sum, item) => sum + item);
    public static T Lerp<T>(T from, T to, double t) where T : IAdditionOperators<T, T, T>, IScalable<T> => from * (1 - t) + to * t;
    public static T Centroid<T>(params T[] points) where T : IAdditionOperators<T, T, T>, IAdditiveIdentity<T, T>, IScalable<T> => Sum(points) * (1.0 / points.Length);
}

public static class Program
{
    public static void Main()
    {
        Vec2 v = new Vec2(3, 4), w = (1, -2), sum = v + w;
        var (x, y) = v - w * 2;
        Console.WriteLine("vectors: " + sum + " " + (v - w) + " " + -v + " " + v * 2 + " " + 0.5 * v + " " + v / 4 + " dot=" + Fmt.F(v * w) + " cross=" + Fmt.F(v ^ w) + " len=" + Fmt.F((double)v) + " tuple=" + Fmt.F(v * (2, 1))
            + " decon=" + Fmt.F(x) + "/" + Fmt.F(y) + " eq=" + (v == (3.0, 4.0)) + (v != w) + (v * 1 == v) + " unit=" + v / (double)v);
        Console.WriteLine("result kinds: " + Fmt.Kind(v * 2) + " " + Fmt.Kind(2 * v) + " " + Fmt.Kind(v * v) + " " + Fmt.Kind(v ^ w) + " " + Fmt.Kind(Mat2.Identity * v) + " " + Fmt.Kind(Mat2.Identity * Mat2.Identity) + " " + Fmt.Kind(Mat2.Identity * 2)
            + " " + Fmt.Kind(new Length<Meters>(1) * 2) + " " + Fmt.Kind(new Length<Meters>(1) * new Length<Meters>(2)) + " " + Fmt.Kind(new Length<Feet>(1) / new Length<Feet>(2)) + " " + Fmt.Kind(new Length<Feet>(1) / 2)
            + " " + Fmt.Kind(new Length<Feet>(1) / TimeSpan.FromSeconds(1)) + " " + Fmt.Kind(v * 2 * v) + " " + Fmt.Kind(v * (2 * v)) + " " + Fmt.Kind(2 * v * v * v));

        Mat2 m = new Mat2(2, 1, 0, 3), quarter = Mat2.Rotation(1);
        Console.WriteLine("matrices: " + m * v + " " + m * m + " " + m * 2 + " " + (m + Mat2.Identity) + " " + -m + " " + ~m + " " + !m + " " + m * !m + " det=" + Fmt.F(m.Determinant) + "/" + Fmt.F((!m).Determinant) + " m[0,1]=" + Fmt.F(m[0, 1]));
        Console.WriteLine("rotations: " + quarter * v + " " + quarter * quarter * v + " " + (Mat2.Identity << 3) * v + " " + (Mat2.Identity << 1 >> 1) + " " + ((m << 2) * v == -(m * v)) + " " + (quarter * (quarter * v) == quarter * quarter * v)
            + " " + (m * quarter * v) + " vs " + (quarter * m * v));

        Length<Meters> track = 400, sprint = new Length<Meters>(100);
        Length<Feet> yard = 3;
        Length<Kilometers> marathon = 42.195;
        Area field = new Length<Meters>(105) * new Length<Meters>(68), room = new Length<Feet>(10) * new Length<Feet>(12);
        Speed pace = marathon / new TimeSpan(2, 0, 35), sprintPace = sprint / TimeSpan.FromSeconds(9.58);
        Console.WriteLine("lengths: " + (track + sprint) + " " + (track - sprint * 5) + " " + -yard + " " + Fmt.F(track / sprint) + " " + yard.To<Meters>() + " " + marathon.To<Feet>() + " " + track.To<Kilometers>() + " " + (yard * 2).To<Feet>()
            + " " + (track > sprint) + " " + (yard.To<Meters>() < sprint) + " " + Fmt.F((double)marathon) + " | areas: " + field + " " + room + " " + (field + room) + " " + field / new Length<Meters>(68)
            + " | speeds: " + pace + " " + sprintPace + " " + pace * TimeSpan.FromMinutes(30) + " " + (TimeSpan.FromSeconds(10) * sprintPace).To<Feet>());

        foreach (Length<Meters> leg in new double[] { 1609.344, 0.3048, 5000 })
            Console.WriteLine("  convert " + leg + " = " + leg.To<Feet>() + " = " + leg.To<Kilometers>() + "; x2 " + (leg + leg).To<Feet>() + "; at " + pace + " takes " + Fmt.F((double)leg / pace.MetersPerSecond) + "s; square " + leg * leg);
        Console.WriteLine("generic: " + Geometry.Sum(new[] { v, w, (10, 10) }) + " " + Geometry.Sum(new Length<Feet>[] { 1, 2, 3.5 }) + " " + Geometry.Sum(Array.Empty<Vec2>()) + " " + Geometry.Sum(new[] { 1.5, 2.5 }).ToString(CultureInfo.InvariantCulture)
            + " lerp=" + Geometry.Lerp(v, w, 0.25) + "," + Geometry.Lerp(track, sprint, 0.5) + " centroid=" + Geometry.Centroid<Vec2>((0, 0), (6, 0), (0, 9)) + "," + Geometry.Centroid(track, sprint, 10)
            + " max=" + new[] { sprint, track, 250 }.Max() + " sorted=" + string.Join("<", new Length<Feet>[] { 5, 1, 3 }.OrderBy(l => l)));

        Fixed one = 1, half = (Fixed)0.5, pi = (Fixed)3.14159, minusTwo = -2;
        Fixed counter = half;
        Fixed before = counter++, after = ++counter;
        counter >>= 1;
        Fixed logical = minusTwo;
        logical >>>= 30;
        Console.WriteLine("fixed: " + (one + half) + " " + pi * 2 + " " + pi / 2 + " " + (pi << 2) + " " + (pi >> 1) + " " + (minusTwo >> 1) + " " + (minusTwo >>> 31) + " " + logical + " " + before + " " + after + " " + counter + " " + --counter
            + " " + (one / 3 * 3) + " " + half.CompareTo(one) + " " + new[] { pi, minusTwo, half }.Max() + " " + (one << 14 << 1 >> 15));

        var odometer = new Odometer();
        Odometer sameOdometer = odometer;
        odometer += track;
        odometer += yard;
        odometer += marathon;
        odometer += new Length<Feet>(10) + yard;
        odometer -= 0.9144;
        odometer++;
        ++odometer;
        Console.WriteLine("odometer: " + odometer.Total + " legs=" + odometer.Legs + " units=" + odometer.Units + " same=" + ReferenceEquals(sameOdometer, odometer) + " km=" + odometer.Total.To<Kilometers>());

        var path = new Vec2[] { (0, 0), (3, 4), (3, 10), (-5, 10) };
        double travelled = 0, twiceArea = 0;
        for (int i = 0; i < path.Length; i++)
        {
            Vec2 next = path[(i + 1) % path.Length];
            travelled += (double)(next - path[i]);
            twiceArea += path[i] ^ next;
            Console.WriteLine("  leg " + i + ": " + path[i] + " -> " + next + " step " + (next - path[i]) + " turned " + quarter * (next - path[i]) + " mid " + Geometry.Lerp(path[i], next, 0.5));
        }
        Console.WriteLine("path: perimeter=" + Fmt.F(travelled) + " area=" + Fmt.F(Math.Abs(twiceArea) / 2) + " centroid=" + Geometry.Centroid(path) + " bbox=" + Fmt.F(path.Max(p => p.X) - path.Min(p => p.X)) + "x" + Fmt.F(path.Max(p => p.Y)));
    }
}
