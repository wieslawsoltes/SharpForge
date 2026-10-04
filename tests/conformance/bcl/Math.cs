// Authored BCL behaviour cases; common.cs supplies culture and canonical result capture.
static partial class Oracle
{
    public static void Main()
    {
        Begin("math");
        Case("math-abs-int32", () => Math.Abs(-42));
        Case("math-abs-int32-min", () => Math.Abs(int.MinValue));
        Case("math-abs-int64-min", () => Math.Abs(long.MinValue));
        Case("math-abs-decimal", () => Math.Abs(-12.5m));
        Case("math-abs-negative-zero-bits", () => BitConverter.DoubleToInt64Bits(Math.Abs(-0.0)));
        Case("math-ceiling-positive", () => Math.Ceiling(2.25));
        Case("math-ceiling-negative", () => Math.Ceiling(-2.25));
        Case("math-floor-positive", () => Math.Floor(2.75));
        Case("math-floor-negative", () => Math.Floor(-2.25));
        Case("math-truncate-positive", () => Math.Truncate(2.75));
        Case("math-truncate-negative", () => Math.Truncate(-2.75));
        Case("math-round-even-lower", () => Math.Round(2.5));
        Case("math-round-even-upper", () => Math.Round(3.5));
        Case("math-round-away-positive", () => Math.Round(2.5, MidpointRounding.AwayFromZero));
        Case("math-round-away-negative", () => Math.Round(-2.5, MidpointRounding.AwayFromZero));
        Case("math-round-decimal-even", () => Math.Round(1.225m, 2, MidpointRounding.ToEven));
        Case("math-round-decimal-away", () => Math.Round(1.225m, 2, MidpointRounding.AwayFromZero));
        Case("math-round-double-digits-limit", () => Math.Round(1.0, 16));
        Case("math-round-decimal-digits-limit", () => Math.Round(1.0m, 29));
        Case("math-sign-negative", () => Math.Sign(-10));
        Case("math-sign-zero", () => Math.Sign(0));
        Case("math-sign-positive", () => Math.Sign(42));
        Case("math-sign-nan", () => Math.Sign(double.NaN));
        Case("math-min-integer", () => Math.Min(-5, 5));
        Case("math-max-int64", () => Math.Max(long.MinValue, long.MaxValue));
        Case("math-min-nan", () => Math.Min(double.NaN, 1.0));
        Case("math-min-zero-bits", () => BitConverter.DoubleToInt64Bits(Math.Min(-0.0, 0.0)));
        Case("math-power-integer", () => Math.Pow(2.0, 10.0));
        Case("math-power-negative-exponent", () => Math.Pow(2.0, -3.0));
        Case("math-sqrt-square", () => Math.Sqrt(81.0));
        Case("math-sqrt-negative", () => Math.Sqrt(-1.0));
        Case("math-clamp-inside", () => Math.Clamp(5, 0, 10));
        Case("math-clamp-below", () => Math.Clamp(-5, 0, 10));
        Case("math-clamp-above", () => Math.Clamp(20, 0, 10));
        Case("math-clamp-reversed-range", () => Math.Clamp(5, 10, 0));
        Case("math-divrem-negative", () => { int quotient = Math.DivRem(-17, 5, out int remainder); return quotient.ToString(CultureInfo.InvariantCulture) + ":" + remainder.ToString(CultureInfo.InvariantCulture); });
        Case("math-ieee-remainder-tie", () => Math.IEEERemainder(7.0, 2.0));
        Case("math-bigmul-max", () => Math.BigMul(int.MaxValue, int.MaxValue));
        Case("math-log-one", () => Math.Log(1.0));
        Case("math-log-negative", () => Math.Log(-1.0));
    }
}
