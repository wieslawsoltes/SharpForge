using System;
using System.Collections.Generic;
using System.Globalization;
using System.Numerics;

public interface IShape<TSelf, TNumber>
    where TSelf : IShape<TSelf, TNumber>
    where TNumber : INumber<TNumber>
{
    static abstract TSelf Unit { get; }
    static abstract string Kind { get; }
    static virtual int Sides => 0;
    TNumber Area { get; }
    TSelf Scale(TNumber factor);
}

public readonly record struct Square<T>(T Side) : IShape<Square<T>, T> where T : INumber<T>
{
    public static Square<T> Unit => new Square<T>(T.One);
    public static string Kind => "square";
    public static int Sides => 4;
    public T Area => Side * Side;
    public Square<T> Scale(T factor) => new Square<T>(Side * factor);
}

public readonly record struct Circle(double Radius) : IShape<Circle, double>
{
    public static Circle Unit => new Circle(1);
    public static string Kind => "circle";
    public double Area => Math.PI * Radius * Radius;
    public Circle Scale(double factor) => new Circle(Radius * factor);
}

public readonly struct Fraction : IAdditionOperators<Fraction, Fraction, Fraction>, IMultiplyOperators<Fraction, Fraction, Fraction>,
    IAdditiveIdentity<Fraction, Fraction>, IMultiplicativeIdentity<Fraction, Fraction>, IComparable<Fraction>
{
    public Fraction(long numerator, long denominator)
    {
        if (denominator == 0) throw new DivideByZeroException();
        long divisor = Gcd(Math.Abs(numerator), Math.Abs(denominator));
        if (denominator < 0) divisor = -divisor;
        Numerator = numerator / divisor;
        Denominator = denominator / divisor;
    }

    public long Numerator { get; }
    public long Denominator { get; }
    public static Fraction AdditiveIdentity => new Fraction(0, 1);
    public static Fraction MultiplicativeIdentity => new Fraction(1, 1);
    private static long Gcd(long a, long b) => b == 0 ? (a == 0 ? 1 : a) : Gcd(b, a % b);
    public static Fraction operator +(Fraction a, Fraction b) => new Fraction(a.Numerator * b.Denominator + b.Numerator * a.Denominator, a.Denominator * b.Denominator);
    public static Fraction operator *(Fraction a, Fraction b) => new Fraction(a.Numerator * b.Numerator, a.Denominator * b.Denominator);
    public int CompareTo(Fraction other) => (Numerator * other.Denominator).CompareTo(other.Numerator * Denominator);
    public override string ToString() => Denominator == 1 ? Numerator.ToString() : Numerator + "/" + Denominator;
}

public static class Algebra
{
    public static T Sum<T>(IEnumerable<T> values) where T : IAdditionOperators<T, T, T>, IAdditiveIdentity<T, T>
    {
        T total = T.AdditiveIdentity;
        foreach (var value in values) total += value;
        return total;
    }

    public static T Product<T>(params T[] values) where T : IMultiplyOperators<T, T, T>, IMultiplicativeIdentity<T, T>
    {
        T total = T.MultiplicativeIdentity;
        foreach (var value in values) total = total * value;
        return total;
    }

    public static T Power<T>(T value, int exponent) where T : IMultiplyOperators<T, T, T>, IMultiplicativeIdentity<T, T>
    {
        T result = T.MultiplicativeIdentity;
        while (exponent > 0)
        {
            if ((exponent & 1) == 1) result *= value;
            value *= value;
            exponent >>= 1;
        }
        return result;
    }

    public static T Clamp<T>(T value, T low, T high) where T : IComparable<T> => value.CompareTo(low) < 0 ? low : value.CompareTo(high) > 0 ? high : value;

    public static TNumber Mean<TNumber>(ReadOnlySpan<TNumber> values) where TNumber : INumber<TNumber>
    {
        TNumber total = TNumber.Zero;
        foreach (var value in values) total += value;
        return total / TNumber.CreateChecked(values.Length);
    }

    public static string Describe<TShape, TNumber>(TNumber factor)
        where TShape : IShape<TShape, TNumber>
        where TNumber : INumber<TNumber>
    {
        TShape scaled = TShape.Unit.Scale(factor);
        return string.Format(CultureInfo.InvariantCulture, "{0}/{1} sides, area {2:0.###} > unit: {3}", TShape.Kind, TShape.Sides, scaled.Area, scaled.Area > TShape.Unit.Area);
    }

    public static TResult Convert<TSource, TResult>(TSource value) where TSource : INumber<TSource> where TResult : INumber<TResult>
        => TResult.CreateSaturating(value);

    public static int BitCount<T>(T value) where T : IBinaryInteger<T> => int.CreateChecked(T.PopCount(value));
}

public static class Program
{
    public static void Main()
    {
        Console.WriteLine(Algebra.Sum(new[] { 1, 2, 3, 4 }) + " " + Algebra.Sum(new[] { 1.5, 2.25 }).ToString(CultureInfo.InvariantCulture) + " " + Algebra.Sum(new List<decimal> { 0.1m, 0.2m }) + " " + Algebra.Sum(new long[0]));
        Console.WriteLine(Algebra.Product(2, 3, 7) + " " + Algebra.Product(1.5f, 2f) + " " + Algebra.Product<BigInteger>(long.MaxValue, long.MaxValue, 2));
        Console.WriteLine(Algebra.Power(3, 13) + " " + Algebra.Power(2UL, 63) + " " + Algebra.Power(new BigInteger(7), 40) + " " + Algebra.Power(1.1m, 3));
        var fractions = new[] { new Fraction(1, 2), new Fraction(1, 3), new Fraction(1, 6), new Fraction(-3, -4) };
        Console.WriteLine(Algebra.Sum(fractions) + " " + Algebra.Product(fractions) + " " + Algebra.Power(new Fraction(2, 3), 5) + " " + Algebra.Clamp(new Fraction(9, 4), fractions[1], fractions[0]));
        Console.WriteLine(Algebra.Clamp(15, 0, 10) + " " + Algebra.Clamp("m", "a", "f") + " " + Algebra.Clamp(2.5, 1.0, 3.0).ToString(CultureInfo.InvariantCulture));
        Console.WriteLine(Algebra.Mean<int>(new[] { 1, 2, 4 }) + " " + Algebra.Mean<double>(new[] { 1.0, 2.0, 4.0 }).ToString("F4", CultureInfo.InvariantCulture) + " " + Algebra.Mean<decimal>(stackalloc decimal[] { 1m, 2m }));
        Console.WriteLine(Algebra.Describe<Square<int>, int>(3));
        Console.WriteLine(Algebra.Describe<Square<decimal>, decimal>(1.5m));
        Console.WriteLine(Algebra.Describe<Circle, double>(2));
        Console.WriteLine(Algebra.Convert<double, byte>(300.7) + " " + Algebra.Convert<int, sbyte>(-1000) + " " + Algebra.Convert<long, float>(1L << 40).ToString(CultureInfo.InvariantCulture) + " " + Algebra.Convert<decimal, int>(-2.9m));
        Console.WriteLine(Algebra.BitCount(255) + " " + Algebra.BitCount(ulong.MaxValue) + " " + Algebra.BitCount((short)-1) + " " + Algebra.BitCount(new BigInteger(1023)));
        Console.WriteLine(new Square<int>(4) + " " + (new Square<int>(4) == Square<int>.Unit.Scale(4)) + " " + new Circle(2).Scale(0.5).Equals(Circle.Unit));
        try { Console.WriteLine(new Fraction(1, 0)); }
        catch (DivideByZeroException) { Console.WriteLine("zero denominator"); }
        try { Console.WriteLine(Algebra.Mean<byte>(new byte[300])); Console.WriteLine(checked(Algebra.Power(10, 9) * 10)); }
        catch (OverflowException) { Console.WriteLine("overflow"); }
    }
}
