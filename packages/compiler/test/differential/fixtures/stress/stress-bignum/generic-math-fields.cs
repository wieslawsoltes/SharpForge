using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Numerics;

public interface IField<T> where T : IField<T>
{
    static abstract T Zero { get; }
    static abstract T One { get; }
    static abstract T operator +(T a, T b);
    static abstract T operator -(T a, T b);
    static abstract T operator *(T a, T b);
    static abstract T operator /(T a, T b);
    static abstract bool IsZero(T value);
    static virtual string FieldName => typeof(T).Name;
    static virtual T FromInt(int n)
    {
        T result = T.Zero;
        for (int i = 0; i < Math.Abs(n); i++) result += T.One;
        return n < 0 ? T.Zero - result : result;
    }
    string Text { get; }
}

public readonly struct Rational : IField<Rational>, IAdditionOperators<Rational, Rational, Rational>, IMultiplyOperators<Rational, Rational, Rational>, IAdditiveIdentity<Rational, Rational>,
    IMultiplicativeIdentity<Rational, Rational>, IComparisonOperators<Rational, Rational, bool>, IParsable<Rational>, IComparable<Rational>, IEquatable<Rational>
{
    private readonly BigInteger denominatorMinusOne; // keeps default(Rational) equal to 0/1
    public Rational(BigInteger numerator, BigInteger denominator)
    {
        if (denominator.IsZero) throw new DivideByZeroException("zero denominator");
        BigInteger divisor = BigInteger.GreatestCommonDivisor(numerator, denominator) * denominator.Sign;
        Numerator = numerator / divisor;
        denominatorMinusOne = denominator / divisor - 1;
    }
    public BigInteger Numerator { get; }
    public BigInteger Denominator => denominatorMinusOne + 1;
    public static Rational Zero => default;
    public static Rational One => new Rational(1, 1);
    public static Rational AdditiveIdentity => Zero;
    public static Rational MultiplicativeIdentity => One;
    public static bool IsZero(Rational value) => value.Numerator.IsZero;
    public string Text => Denominator.IsOne ? Numerator.ToString(CultureInfo.InvariantCulture) : Numerator.ToString(CultureInfo.InvariantCulture) + "/" + Denominator.ToString(CultureInfo.InvariantCulture);
    public static implicit operator Rational(int value) => new Rational(value, 1);
    public static Rational operator +(Rational a, Rational b) => new Rational(a.Numerator * b.Denominator + b.Numerator * a.Denominator, a.Denominator * b.Denominator);
    public static Rational operator -(Rational a, Rational b) => new Rational(a.Numerator * b.Denominator - b.Numerator * a.Denominator, a.Denominator * b.Denominator);
    public static Rational operator *(Rational a, Rational b) => new Rational(a.Numerator * b.Numerator, a.Denominator * b.Denominator);
    public static Rational operator /(Rational a, Rational b) => new Rational(a.Numerator * b.Denominator, a.Denominator * b.Numerator);
    public static bool operator ==(Rational a, Rational b) => a.Equals(b);
    public static bool operator !=(Rational a, Rational b) => !a.Equals(b);
    public static bool operator <(Rational a, Rational b) => a.CompareTo(b) < 0;
    public static bool operator >(Rational a, Rational b) => a.CompareTo(b) > 0;
    public static bool operator <=(Rational a, Rational b) => a.CompareTo(b) <= 0;
    public static bool operator >=(Rational a, Rational b) => a.CompareTo(b) >= 0;
    public int CompareTo(Rational other) => (Numerator * other.Denominator).CompareTo(other.Numerator * Denominator);
    public bool Equals(Rational other) => Numerator == other.Numerator && Denominator == other.Denominator;
    public override bool Equals(object obj) => obj is Rational other && Equals(other);
    public override int GetHashCode() => HashCode.Combine(Numerator, Denominator);
    public override string ToString() => Text;
    public static Rational Parse(string s, IFormatProvider provider)
    {
        string[] parts = s.Split('/');
        return new Rational(BigInteger.Parse(parts[0], provider), parts.Length > 1 ? BigInteger.Parse(parts[1], provider) : BigInteger.One);
    }
    public static bool TryParse(string s, IFormatProvider provider, out Rational result)
    {
        try { result = Parse(s, provider); return true; }
        catch (Exception e) when (e is FormatException or DivideByZeroException) { result = default; return false; }
    }
}

public readonly struct Mod7 : IField<Mod7>, IMultiplyOperators<Mod7, Mod7, Mod7>
{
    private readonly int value;
    private Mod7(int value) { this.value = ((value % 7) + 7) % 7; }
    public static Mod7 Zero => new Mod7(0);
    public static Mod7 One => new Mod7(1);
    public static string FieldName => "GF(7)";
    public static Mod7 FromInt(int n) => new Mod7(n);
    public static bool IsZero(Mod7 v) => v.value == 0;
    public string Text => value.ToString(CultureInfo.InvariantCulture);
    public static Mod7 operator +(Mod7 a, Mod7 b) => new Mod7(a.value + b.value);
    public static Mod7 operator -(Mod7 a, Mod7 b) => new Mod7(a.value - b.value);
    public static Mod7 operator *(Mod7 a, Mod7 b) => new Mod7(a.value * b.value);
    public static Mod7 operator /(Mod7 a, Mod7 b) => b.value == 0 ? throw new DivideByZeroException("no inverse in GF(7)") : a * Algebra.Power(b, 5, One);
}

public readonly struct Real<T> : IField<Real<T>> where T : INumber<T>
{
    public Real(T value) { Value = value; }
    public T Value { get; }
    public static Real<T> Zero => new Real<T>(T.Zero);
    public static Real<T> One => new Real<T>(T.One);
    public static string FieldName => "Real<" + typeof(T).Name + ">";
    public static bool IsZero(Real<T> v) => T.IsZero(v.Value);
    public string Text => Value.ToString(null, CultureInfo.InvariantCulture);
    public static implicit operator Real<T>(T value) => new Real<T>(value);
    public static Real<T> operator +(Real<T> a, Real<T> b) => new Real<T>(a.Value + b.Value);
    public static Real<T> operator -(Real<T> a, Real<T> b) => new Real<T>(a.Value - b.Value);
    public static Real<T> operator *(Real<T> a, Real<T> b) => new Real<T>(a.Value * b.Value);
    public static Real<T> operator /(Real<T> a, Real<T> b) => new Real<T>(a.Value / b.Value);
}

public sealed class Matrix<T> : IMultiplyOperators<Matrix<T>, Matrix<T>, Matrix<T>> where T : IField<T>
{
    private readonly T[,] cells;
    public Matrix(int size, Func<int, int, T> init)
    {
        Size = size;
        cells = new T[size, size];
        for (int r = 0; r < size; r++) for (int c = 0; c < size; c++) cells[r, c] = init(r, c);
    }
    public int Size { get; }
    public T this[int row, int column] => cells[row, column];
    public static Matrix<T> Identity(int size) => new Matrix<T>(size, (r, c) => r == c ? T.One : T.Zero);
    public static Matrix<T> operator *(Matrix<T> a, Matrix<T> b) => new Matrix<T>(a.Size, (r, c) =>
    {
        T sum = T.Zero;
        for (int k = 0; k < a.Size; k++) sum += a[r, k] * b[k, c];
        return sum;
    });
    public T Determinant()
    {
        var work = (T[,])cells.Clone();
        T det = T.One;
        for (int col = 0; col < Size; col++)
        {
            int pivot = col;
            while (pivot < Size && T.IsZero(work[pivot, col])) pivot++;
            if (pivot == Size) return T.Zero;
            if (pivot != col)
            {
                for (int k = 0; k < Size; k++) (work[col, k], work[pivot, k]) = (work[pivot, k], work[col, k]);
                det = T.Zero - det;
            }
            det *= work[col, col];
            for (int row = col + 1; row < Size; row++)
            {
                T factor = work[row, col] / work[col, col];
                for (int k = col; k < Size; k++) work[row, k] -= factor * work[col, k];
            }
        }
        return det;
    }
    public override string ToString() => "[" + string.Join("; ", Enumerable.Range(0, Size).Select(r => string.Join(" ", Enumerable.Range(0, Size).Select(c => cells[r, c].Text)))) + "]";
}

public static class Algebra
{
    public static string Show<T>(T value) => value is IFormattable f ? f.ToString(null, CultureInfo.InvariantCulture) : value.ToString();
    public static T Sum<T>(IEnumerable<T> values) where T : IAdditionOperators<T, T, T>, IAdditiveIdentity<T, T> => values.Aggregate(T.AdditiveIdentity, (sum, v) => sum + v);
    public static T Mean<T>(IReadOnlyCollection<T> values) where T : INumber<T> => Sum(values) / T.CreateChecked(values.Count);
    public static T Clamp<T>(T value, T low, T high) where T : IComparisonOperators<T, T, bool> => value < low ? low : value > high ? high : value;
    public static T Gcd<T>(T a, T b) where T : IBinaryInteger<T>
    {
        while (!T.IsZero(b)) (a, b) = (b, a % b);
        return T.Abs(a);
    }
    public static T Power<T>(T value, int exponent, T one) where T : IMultiplyOperators<T, T, T>
    {
        T result = one;
        for (; exponent > 0; exponent >>= 1, value *= value) if ((exponent & 1) != 0) result *= value;
        return result;
    }
    public static T Power<T>(T value, int exponent) where T : IMultiplyOperators<T, T, T>, IMultiplicativeIdentity<T, T> => Power(value, exponent, T.MultiplicativeIdentity);
    public static T Horner<T>(T x, params T[] coefficients) where T : IAdditionOperators<T, T, T>, IMultiplyOperators<T, T, T>, IAdditiveIdentity<T, T> =>
        coefficients.Aggregate(T.AdditiveIdentity, (acc, c) => acc * x + c);
    public static T RoundTo<T>(T value, int digits) where T : IFloatingPoint<T> => T.Round(value, digits, MidpointRounding.AwayFromZero);
    public static T ParseSum<T>(string csv) where T : IParsable<T>, IAdditionOperators<T, T, T>, IAdditiveIdentity<T, T> => Sum(csv.Split(',').Select(s => T.Parse(s, CultureInfo.InvariantCulture)));
    public static string Convert<TFrom, TTo>(TFrom value) where TFrom : INumber<TFrom> where TTo : INumber<TTo>, IMinMaxValue<TTo>
    {
        string exact;
        try { exact = Show(TTo.CreateChecked(value)); } catch (OverflowException) { exact = "ovf"; }
        return exact + "|" + Show(TTo.CreateSaturating(value)) + "|" + Show(TTo.CreateTruncating(value)) + " (max " + Show(TTo.MaxValue) + ")";
    }
    public static string Describe<T>(int seed) where T : IField<T>
    {
        T x = T.FromInt(seed), third = T.One / T.FromInt(3);
        var hilbert = new Matrix<T>(3, (r, c) => T.One / T.FromInt(r + c + 1));
        var fib = Power(new Matrix<T>(2, (r, c) => r + c < 2 ? T.One : T.Zero), 30, Matrix<T>.Identity(2));
        return T.FieldName + ": x=" + x.Text + " -x=" + T.FromInt(-seed).Text + " 1/3=" + third.Text + " 3*(1/3)=" + (third + third + third).Text + " det(H3)=" + hilbert.Determinant().Text
            + " fib30=" + fib[0, 1].Text + " det(F^30)=" + fib.Determinant().Text;
    }
}

public static class Program
{
    public static void Main()
    {
        Console.WriteLine(Algebra.Describe<Rational>(10));
        Console.WriteLine(Algebra.Describe<Mod7>(10));
        Console.WriteLine(Algebra.Describe<Real<double>>(10));
        Console.WriteLine(Algebra.Describe<Real<decimal>>(10));
        Console.WriteLine(Algebra.Describe<Real<int>>(10));
        Console.WriteLine(Algebra.Describe<Real<BigInteger>>(10));

        Rational half = new Rational(1, 2), third = new Rational(-2, -6);
        Console.WriteLine("sum: " + Algebra.Sum(new[] { 1, 2, 3 }) + " " + Algebra.Sum(new[] { long.MaxValue, 1L }) + " " + Algebra.Show(Algebra.Sum(new[] { 0.1, 0.2, 0.3 })) + " " + Algebra.Show(Algebra.Sum(new[] { 0.1m, 0.2m, 0.3m }))
            + " " + Algebra.Show(Algebra.Sum(new[] { BigInteger.Pow(10, 30), BigInteger.One })) + " " + Algebra.Sum(new[] { half, third, new Rational(1, 6) }) + " " + Algebra.Sum(Array.Empty<Rational>()));
        Console.WriteLine("mean: " + Algebra.Mean(new[] { 1, 2, 4 }) + " " + Algebra.Mean(new[] { 7L, 8L }) + " " + Algebra.Show(Algebra.Mean(new[] { 1.0, 2.0, 4.0 })) + " " + Algebra.Show(Algebra.Mean(new[] { 1m, 2m, 4m }))
            + " " + Algebra.Show(Algebra.Mean(new[] { 1f, 2f })) + " " + Algebra.Show(Algebra.Mean(new BigInteger[] { 10, 21 })) + " " + Algebra.Mean(new byte[] { 100, 100, 100 }));
        Console.WriteLine("clamp: " + Algebra.Clamp(15, 0, 10) + " " + Algebra.Show(Algebra.Clamp(-2.5, -1.0, 1.0)) + " " + Algebra.Clamp(new Rational(7, 3), half, 2) + " " + Algebra.Clamp('m', 'a', 'f') + " " + Algebra.Show(Algebra.Clamp(5m, 5.0m, 9m))
            + " | gcd: " + Algebra.Gcd(84, -36) + " " + Algebra.Gcd(1L << 40, 6L << 20) + " " + Algebra.Gcd((byte)200, (byte)75) + " " + Algebra.Show(Algebra.Gcd(BigInteger.Pow(6, 40), BigInteger.Pow(10, 25))) + " " + Algebra.Gcd((UInt128)1 << 100, (UInt128)48));
        Console.WriteLine("power: " + Algebra.Power(3, 13) + " " + Algebra.Power(3, 21) + " " + Algebra.Power(3L, 21) + " " + Algebra.Show(Algebra.Power(1.5, 5)) + " " + Algebra.Show(Algebra.Power(1.1m, 10)) + " " + Algebra.Show(Algebra.Power(new BigInteger(3), 100))
            + " " + Algebra.Power(new Rational(2, 3), 5) + " " + Algebra.Power(half, 0) + " " + Algebra.Power((byte)2, 9));
        Console.WriteLine("horner: " + Algebra.Horner(2, 1, -3, 0, 5) + " " + Algebra.Show(Algebra.Horner(0.5, 1, -3, 0, 5)) + " " + Algebra.Show(Algebra.Horner(0.5m, 1, -3, 0, 5)) + " " + Algebra.Horner(half, 1, -3, 0, 5)
            + " " + Algebra.Show(Algebra.Horner(new BigInteger(1000), 1, 2, 3, 4)) + " | round: " + Algebra.Show(Algebra.RoundTo(2.345, 2)) + " " + Algebra.Show(Algebra.RoundTo(2.345m, 2)) + " " + Algebra.Show(Algebra.RoundTo(-0.5f, 0)));
        Console.WriteLine("parse: " + Algebra.ParseSum<int>("1,2,3") + " " + Algebra.Show(Algebra.ParseSum<double>("1.5,2.25,1e2")) + " " + Algebra.Show(Algebra.ParseSum<decimal>("0.10,0.20")) + " " + Algebra.Show(Algebra.ParseSum<BigInteger>("99999999999999999999,1"))
            + " " + Algebra.ParseSum<Rational>("1/2,1/3,-5/6,7") + " " + Rational.TryParse("1/0", CultureInfo.InvariantCulture, out _) + " " + Rational.TryParse("x", CultureInfo.InvariantCulture, out _) + " " + (Rational.Parse("4/-6", null) == new Rational(-2, 3)));
        Console.WriteLine("convert 300 -> byte: " + Algebra.Convert<int, byte>(300) + " | -1.5 -> uint: " + Algebra.Convert<double, uint>(-1.5) + " | long.Max -> int: " + Algebra.Convert<long, int>(long.MaxValue)
            + " | 3.99m -> sbyte: " + Algebra.Convert<decimal, sbyte>(3.99m) + " | 2^70 -> long: " + Algebra.Convert<BigInteger, long>(BigInteger.One << 70) + " | NaN -> short: " + Algebra.Convert<double, short>(double.NaN));
        Console.WriteLine("rational order: " + string.Join(" < ", new[] { half, third, new Rational(-1, 2), Rational.Zero, new Rational(5, 10) }.Distinct().OrderBy(r => r)) + " " + (half > third) + " " + (half <= new Rational(2, 4)) + " " + default(Rational).Equals(Rational.Zero));
        try { Console.WriteLine((Mod7.One / Mod7.FromInt(14)).Text); } catch (DivideByZeroException e) { Console.WriteLine("1/14 in GF(7): " + e.Message + "; 1/15 = " + (Mod7.One / Mod7.FromInt(15)).Text); }
        Console.WriteLine("byte mean wraps: " + Algebra.Mean(new[] { byte.MaxValue, byte.MaxValue }) + " sbyte power wraps: " + Algebra.Power((sbyte)3, 5) + " checked create: " + Algebra.Mean(new[] { (Int128)long.MaxValue, long.MaxValue }));
    }
}
