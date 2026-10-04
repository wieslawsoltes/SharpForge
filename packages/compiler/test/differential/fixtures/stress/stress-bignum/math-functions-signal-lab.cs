using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Numerics;

var inv = CultureInfo.InvariantCulture;
// Round first and add +0.0 so that a negative zero never leaks into the output.
string N(double value, int digits = 4) => double.IsFinite(value) ? (Math.Round(value, digits) + 0.0).ToString("F" + digits, inv) : value.ToString(inv);
string C(Complex value) => "(" + N(value.Real, 3) + (value.Imaginary < -0.0005 ? " - " : " + ") + N(Math.Abs(value.Imaginary), 3) + "i)";
string G(double value) => value.ToString("R", inv);

Console.WriteLine("roots: " + N(Math.Sqrt(2)) + " " + N(Math.Cbrt(-27)) + " " + N(Math.Pow(2, 0.5)) + " " + N(Math.Pow(-8, 1.0 / 3)) + " " + G(Math.Pow(2, 10)) + " " + N(Math.Pow(10, -2), 6) + " " + G(Math.Sqrt(-1)) + " " + G(Math.Pow(0, 0))
    + " " + N(MathF.Sqrt(2f)) + " " + N(MathF.Pow(1.5f, 3f)) + " " + N(Math.Sqrt(1e-10), 6) + " " + G(Math.Sqrt(152.2756)));
Console.WriteLine("exp/log: " + N(Math.Exp(1)) + " " + N(Math.Log(10)) + " " + N(Math.Log10(2)) + " " + N(Math.Log2(10)) + " " + N(Math.Log(8, 2)) + " " + G(Math.Log(0)) + " " + G(Math.Log(-1)) + " " + N(Math.Exp(-745), 6)
    + " " + G(Math.Exp(710)) + " " + N(MathF.Log(MathF.E)) + " " + N(MathF.Exp(0.5f)) + " " + N(Math.Log(Math.E * Math.E)));
Console.WriteLine("trig: " + string.Join(" ", new[] { 0.0, 30, 45, 60, 90, 180, 270 }.Select(deg => N(Math.Sin(deg * Math.PI / 180), 3) + "/" + N(Math.Cos(deg * Math.PI / 180), 3)))
    + " | atan2: " + string.Join(" ", new[] { (1.0, 1.0), (1.0, -1.0), (-1.0, -1.0), (-1.0, 1.0), (0.0, -1.0) }.Select(p => N(Math.Atan2(p.Item1, p.Item2) * 180 / Math.PI, 1)))
    + " | " + N(Math.Tan(Math.PI / 4)) + " " + N(Math.Asin(1) * 2) + " " + N(Math.Acos(-1)) + " " + N(Math.Sinh(1)) + " " + N(Math.Tanh(20)) + " " + N(MathF.Sin(MathF.PI / 6)) + " " + N(MathF.Atan2(1f, 1f) * 4));

double[] samples = { 2.5, -2.5, 3.5, -3.5, 2.4999, -0.4, 0.5, 1e15 + 0.5 };
Console.WriteLine("floor:    " + string.Join(" ", samples.Select(v => G(Math.Floor(v)))));
Console.WriteLine("ceiling:  " + string.Join(" ", samples.Select(v => G(Math.Ceiling(v) + 0.0))));
Console.WriteLine("truncate: " + string.Join(" ", samples.Select(v => G(Math.Truncate(v) + 0.0))));
Console.WriteLine("round:    " + string.Join(" ", samples.Select(v => G(Math.Round(v) + 0.0))));
Console.WriteLine("away:     " + string.Join(" ", samples.Select(v => G(Math.Round(v, MidpointRounding.AwayFromZero) + 0.0))));
Console.WriteLine("digits: " + G(Math.Round(2.345, 2)) + " " + G(Math.Round(2.355, 2)) + " " + G(Math.Round(1234.5678, 1)) + " " + G(Math.Round(-0.125, 2, MidpointRounding.ToZero)) + " " + G(MathF.Round(2.5f)) + " " + G(MathF.Round(3.5f))
    + " " + G(MathF.Floor(-0.5f)) + " " + G(MathF.Truncate(-7.9f)) + " " + G(Math.Round(0.1 + 0.2, 15)) + " " + ((int)Math.Round(2.5) + (int)Math.Round(3.5)) + " " + (long)Math.Floor(-1e10 - 0.5));

int quotient = Math.DivRem(-17, 5, out int remainder);
var (q2, r2) = Math.DivRem(17L, -5L);
Console.WriteLine("integer: " + quotient + "r" + remainder + " " + q2 + "r" + r2 + " " + Math.BigMul(int.MaxValue, int.MaxValue) + " " + Math.BigMul(ulong.MaxValue, 3UL, out ulong low) + ":" + low + " " + Math.Abs(-5L) + " " + Math.Sign(-0.0)
    + Math.Sign(-3) + Math.Sign(2.5m) + " " + Math.Clamp(15, 0, 10) + " " + Math.Clamp(-1.5, -1, 1).ToString(inv) + " " + Math.Max((byte)3, (short)-4) + " " + Math.Min(3u, 4L) + " " + Math.Max(1.5f, 2) + " " + int.Abs(-9) + " " + long.Max(3, 4)
    + " " + G(Math.IEEERemainder(7, 2)) + "," + G(7.0 % 2) + " " + G(Math.IEEERemainder(-7.5, 2)) + "," + G(-7.5 % 2) + " " + G(Math.CopySign(3, -0.0)) + " " + G(Math.FusedMultiplyAdd(2, 3, 4)) + " " + G(Math.ScaleB(1.5, 4)) + " " + Math.ILogB(1000));
try { Console.WriteLine(Math.Abs(int.MinValue)); } catch (OverflowException) { Console.WriteLine("Math.Abs(int.MinValue) overflows; long: " + Math.Abs((long)int.MinValue)); }

double zero = 0.0, nan = double.NaN, inf = double.PositiveInfinity;
Console.WriteLine("special: " + G(1 / zero) + " " + G(-1 / zero) + " " + G(zero / zero) + " " + G(inf - inf) + " " + G(inf * 0) + " " + G(1 / -inf) + " " + (nan == zero / zero) + " " + (nan != zero / zero) + " " + nan.Equals(nan) + " " + (nan < 1) + " " + (nan >= 1)
    + " " + !(nan < 1) + " " + (0.0 == -0.0) + " " + double.IsNegative(-0.0) + " " + G(Math.Max(nan, 1)) + " " + G(Math.Min(-0.0, 0.0)) + " " + G(Math.MaxMagnitude(-3, 2)) + " " + (double.Epsilon > 0) + " " + (double.Epsilon / 2 == 0)
    + " " + (Math.BitIncrement(1.0) - 1.0 == double.Epsilon) + " " + G(Math.BitIncrement(1.0) - 1.0) + " " + float.IsSubnormal(1e-40f) + " " + double.IsFinite(double.MaxValue * 2) + " " + nan.CompareTo(-inf) + " " + G(Math.Sqrt(inf)));

// Newton's method, Simpson's rule and compensated summation.
double Newton(Func<double, double> f, Func<double, double> df, double x, out int steps)
{
    for (steps = 0; steps < 50; steps++)
    {
        double next = x - f(x) / df(x);
        if (Math.Abs(next - x) < 1e-13) return next;
        x = next;
    }
    return x;
}
double Simpson(Func<double, double> f, double a, double b, int n)
{
    double h = (b - a) / n, sum = f(a) + f(b);
    for (int i = 1; i < n; i++) sum += f(a + i * h) * (i % 2 == 0 ? 2 : 4);
    return sum * h / 3;
}
double root = Newton(x => x * x * x - 2 * x - 5, x => 3 * x * x - 2, 2, out int iterations);
Console.WriteLine("newton: " + N(root, 9) + " in " + iterations + " steps, residual<1e-9: " + (Math.Abs(root * root * root - 2 * root - 5) < 1e-9) + " | sqrt(2) by newton: " + N(Newton(x => x * x - 2, x => 2 * x, 1, out _), 12)
    + " | simpson: " + N(Simpson(Math.Sin, 0, Math.PI, 100), 6) + " " + N(Simpson(x => 4 / (1 + x * x), 0, 1, 64), 8) + " " + N(Simpson(x => x * x * x, -1, 3, 2), 6));
double naive = 0, kahan = 0, carry = 0;
for (int i = 0; i < 10_000; i++)
{
    naive += 0.1;
    double y = 0.1 - carry, t = kahan + y;
    carry = (t - kahan) - y;
    kahan = t;
}
var data = new List<double> { 2, 4, 4, 4, 5, 5, 7, 9 };
double mean = data.Average(), variance = data.Sum(v => (v - mean) * (v - mean)) / data.Count;
Console.WriteLine("sums: naive=" + G(naive) + " kahan=" + G(kahan) + " exact=" + (kahan == 1000.0) + " | stats: mean=" + G(mean) + " stdev=" + G(Math.Sqrt(variance)) + " hypot=" + G(Math.Sqrt(3 * 3 + 4 * 4)) + " geo=" + N(Math.Pow(data.Aggregate(1.0, (a, v) => a * v), 1.0 / data.Count), 5));

// Complex numbers: quadratic roots, polar form and a small discrete Fourier transform.
(Complex, Complex) Quadratic(double a, double b, double c)
{
    Complex disc = Complex.Sqrt(new Complex(b * b - 4 * a * c, 0));
    return ((-b + disc) / (2 * a), (-b - disc) / (2 * a));
}
foreach (var (a, b, c) in new[] { (1.0, -3.0, 2.0), (1.0, 2.0, 5.0), (2.0, 0.0, 8.0) })
{
    var (x1, x2) = Quadratic(a, b, c);
    Console.WriteLine("quadratic " + N(a, 0) + "," + N(b, 0) + "," + N(c, 0) + ": " + C(x1) + " " + C(x2) + " product=" + C(x1 * x2) + " sum=" + C(x1 + x2) + " |x1|=" + N(x1.Magnitude, 3));
}
Complex unit = Complex.FromPolarCoordinates(2, Math.PI / 3), imaginary = Complex.ImaginaryOne;
Console.WriteLine("complex: " + C(unit) + " " + C(Complex.Conjugate(unit)) + " " + C(unit * unit) + " " + C(Complex.Pow(unit, 3)) + " " + C(1 / imaginary) + " " + C(imaginary * imaginary) + " " + C(Complex.Exp(imaginary * Math.PI))
    + " phase=" + N(unit.Phase * 180 / Math.PI, 1) + " abs=" + N(Complex.Abs(new Complex(3, -4)), 1) + " eq=" + (new Complex(1, 2) + new Complex(0, -2) == Complex.One) + " " + C((Complex)2.5 - new Complex(0.5, 1)));
double[] signal = Enumerable.Range(0, 8).Select(k => 1 + 2 * Math.Cos(2 * Math.PI * k / 8) + Math.Sin(2 * Math.PI * 3 * k / 8)).ToArray();
Complex[] spectrum = Enumerable.Range(0, 8).Select(bin => Enumerable.Range(0, 8).Aggregate(Complex.Zero, (acc, k) => acc + signal[k] * Complex.Exp(new Complex(0, -2 * Math.PI * bin * k / 8)))).ToArray();
Console.WriteLine("dft magnitudes: " + string.Join(" ", spectrum.Select(s => N(s.Magnitude, 3))) + " | energy: " + N(signal.Sum(v => v * v), 3) + " = " + N(spectrum.Sum(s => s.Magnitude * s.Magnitude) / 8, 3));

// Half precision quantisation and exact 128-bit accumulation.
float[] weights = { 0.1f, 1f / 3, 2.5f, 1000.123f, 65519f, 65520f, 1e-8f, -0f };
Console.WriteLine("half: " + string.Join(" ", weights.Select(w => ((float)(Half)w).ToString("R", inv))) + " | max=" + ((double)Half.MaxValue).ToString(inv) + " eps=" + ((double)Half.Epsilon).ToString("E3", inv)
    + " " + ((Half)1f == (Half)1.0) + " " + ((Half)2f > (Half)1.5f) + " " + Half.IsNaN(Half.NaN) + " " + Half.IsNegative((Half)(-0f)));
Int128 dot = 0;
long[] xs = { long.MaxValue, long.MinValue + 1, 4_000_000_000_000, -3 }, ys = { long.MaxValue, long.MaxValue, 5_000_000, 7 };
for (int i = 0; i < xs.Length; i++) dot += (Int128)xs[i] * ys[i];
Console.WriteLine("dot128: " + dot.ToString(inv) + " naive long: " + unchecked(xs[0] * ys[0] + xs[1] * ys[1] + xs[2] * ys[2] + xs[3] * ys[3]) + " double: " + ((double)dot).ToString("E12", inv)
    + " sqrt: " + ((long)Math.Sqrt((double)dot)).ToString(inv) + " " + UInt128.Log2((UInt128)dot) + " " + Int128.Sign(-dot) + " " + (dot / 1_000_000_000).ToString("N0", inv));
