using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

public readonly struct Complex2
{
    public Complex2(double re, double im) { Re = re; Im = im; }
    public double Re { get; }
    public double Im { get; }
    public double Magnitude => Math.Sqrt(Re * Re + Im * Im);
    public static Complex2 operator +(Complex2 a, Complex2 b) => new Complex2(a.Re + b.Re, a.Im + b.Im);
    public static Complex2 operator *(Complex2 a, Complex2 b) => new Complex2(a.Re * b.Re - a.Im * b.Im, a.Re * b.Im + a.Im * b.Re);
    public static implicit operator Complex2(double re) => new Complex2(re, 0);
    public override string ToString() => string.Format(CultureInfo.InvariantCulture, "{0:0.###}{1:+0.###;-0.###}i", Re, Im);
}

public static class Numeric
{
    public static double Integrate(Func<double, double> f, double from, double to, int steps)
    {
        double h = (to - from) / steps, sum = f(from) + f(to);
        for (int i = 1; i < steps; i++) sum += f(from + i * h) * (i % 2 == 0 ? 2 : 4);
        return sum * h / 3;
    }

    public static double Newton(Func<double, double> f, Func<double, double> derivative, double guess, out int iterations)
    {
        iterations = 0;
        while (iterations < 50)
        {
            double next = guess - f(guess) / derivative(guess);
            iterations++;
            if (Math.Abs(next - guess) < 1e-12) return next;
            guess = next;
        }
        return double.NaN;
    }

    public static (double Mean, double Deviation) Statistics(IReadOnlyCollection<double> values)
    {
        double mean = values.Average();
        return (mean, Math.Sqrt(values.Sum(v => (v - mean) * (v - mean)) / values.Count));
    }

    public static int Mandelbrot(Complex2 c, int limit)
    {
        Complex2 z = 0;
        for (int i = 0; i < limit; i++)
        {
            z = z * z + c;
            if (z.Magnitude > 2) return i;
        }
        return limit;
    }

    public static double KahanSum(IEnumerable<double> values)
    {
        double sum = 0, compensation = 0;
        foreach (double value in values)
        {
            double y = value - compensation, t = sum + y;
            compensation = t - sum - y;
            sum = t;
        }
        return sum;
    }
}

public static class Program
{
    private static string F(double value, string format = "R") => value.ToString(format, CultureInfo.InvariantCulture);

    public static void Main()
    {
        Console.WriteLine(string.Join(" ", F(Numeric.Integrate(Math.Sin, 0, Math.PI, 100), "F8"), F(Numeric.Integrate(x => x * x, 0, 3, 10), "F6"), F(Numeric.Newton(x => x * x - 2, x => 2 * x, 1, out int steps), "F12"), steps, F(Numeric.Newton(x => x * x + 1, x => 2 * x, 3, out _))));
        var (mean, deviation) = Numeric.Statistics(new[] { 2.0, 4, 4, 4, 5, 5, 7, 9 });
        Console.WriteLine(F(mean) + " " + F(deviation) + " " + F(Enumerable.Repeat(0.1, 10).Sum()) + " " + F(Numeric.KahanSum(Enumerable.Repeat(0.1, 10))) + " " + (Enumerable.Repeat(0.1, 10).Sum() == 1.0));
        for (double im = 1; im >= -1; im -= 0.5)
        {
            var row = new char[16];
            for (int column = 0; column < row.Length; column++) row[column] = " .:*#"[Math.Min(4, Numeric.Mandelbrot(new Complex2(-2 + column * 0.17, im), 12) / 3)];
            Console.WriteLine(new string(row) + "|");
        }
        Complex2 i = new Complex2(0, 1), sum = i * i + 1;
        Console.WriteLine(i * i + " " + sum + " " + (new Complex2(1, 2) * new Complex2(3, -1)) + " " + F(new Complex2(3, 4).Magnitude));

        double nan = double.NaN, nan2 = nan, huge = 1e40, inf = double.PositiveInfinity, zero = 0.0, negZero = -0.0, eps = double.Epsilon;
        Console.WriteLine($"{nan == nan2} {nan != nan2} {nan < 1} {nan > 1} {nan.Equals(nan)} {double.IsNaN(nan + 1)} {inf > double.MaxValue} {inf - inf} {inf * 0} {-inf} {1 / zero} {1 / negZero} {zero == negZero} {zero.Equals(negZero)} {double.IsNegative(negZero)} {eps > 0} {eps / 2} {Math.Sqrt(-1)} {Math.Max(nan, 1)} {Math.Min(negZero, zero)}");
        Console.WriteLine(string.Join(" ", Math.Round(2.5), Math.Round(3.5), Math.Round(-2.5), Math.Round(2.5, MidpointRounding.AwayFromZero), Math.Round(2.675, 2), Math.Round(1.005, 2), Math.Floor(-0.5), Math.Ceiling(-0.5), Math.Truncate(-2.9), (int)2.9, (int)-2.9, (long)1e18, Math.Round(1234.5678, 2), Math.Round(1234.5678, -0 + 1)));
        Console.WriteLine(string.Join(" ", F(Math.Pow(2, 0.5), "F6"), Math.Pow(2, 10), Math.Pow(0, 0), Math.Pow(-8, 1.0 / 3), F(Math.Exp(1), "F6"), F(Math.Log(Math.E)), Math.Log10(1000), Math.Log2(8), F(Math.Sin(Math.PI / 6), "F6"), F(Math.Cos(Math.PI), "F1"), F(Math.Atan2(1, 1) * 4, "F6"), Math.Abs(-3.5), Math.Sign(-0.1), F(Math.Cbrt(27)), F(Math.Tanh(0.5), "F6"), Math.IEEERemainder(10, 3), 10 % 3.5, Math.Clamp(5.5, 1, 3), Math.FusedMultiplyAdd(2, 3, 4), Math.Truncate(1e15 + 0.5)));
        float f = 16777216f, third = 1f / 3;
        Console.WriteLine($"{f + 1 == f} {(double)third == 1.0 / 3} {F(third)} {F((double)third)} {(float)0.1 == 0.1f} {0.1f + 0.2f == 0.3f} {F(0.1f + 0.2f)} {F(0.1 + 0.2)} {float.MaxValue * 2} {(float)huge} {F(float.Epsilon)} {1e308 * 10} {F(123456789f)} {F(1.0)} {F(1e21)} {F(1e-5)} {F(100.0)} {F(0.000123)}");
        Console.WriteLine(string.Join(" ", F(1234567.891, "N2"), F(0.000012345, "E2"), F(0.5, "P1"), F(1234.5, "0000.00"), F(1234.5, "#,#.#"), F(-1234.5, "0.0;(0.0)"), F(5, "F3"), F(1e6, "G3"), F(123.456, "G4"), F(0.1 + 0.2, "G17"), F(1.0 / 3, "F20"), F(double.MaxValue, "E"), F(255, "0.0e+0"), double.Parse("1e3", CultureInfo.InvariantCulture), double.Parse("-.5", CultureInfo.InvariantCulture), double.TryParse("NaN", NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) && double.IsNaN(parsed)));
        Console.WriteLine(BitConverter.DoubleToInt64Bits(1.0).ToString("X") + " " + BitConverter.SingleToInt32Bits(-2f).ToString("X") + " " + BitConverter.Int64BitsToDouble(0x4009_21FB_5444_2D18).ToString("R", CultureInfo.InvariantCulture) + " " + (1.0).CompareTo(nan) + " " + nan.CompareTo(nan) + " " + double.MinValue.CompareTo(double.NegativeInfinity) + " " + Math.ScaleB(1, 10) + " " + Math.BitDecrement(1.0).ToString("R", CultureInfo.InvariantCulture));
    }
}
