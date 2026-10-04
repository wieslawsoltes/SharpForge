using System;
public enum Small : sbyte { Min = -128, Max = 127 }
public enum Level : long { Low = 1 }
public enum Op : byte { A, B }
public delegate int Transform(int value);
public sealed class Natural
{
    public readonly ulong Value;
    private Natural(ulong value) { Value = value; }
    public static implicit operator Natural(ulong value) => new Natural(value);
    public static Natural operator +(Natural a, Natural b) => new Natural(a.Value + b.Value);
    public static Natural operator *(Natural a, Natural b) => new Natural(a.Value * b.Value);
    public static Natural Pow(Natural value, int exponent) { Natural result = 1; for (int i = 0; i < exponent; i++) result *= value; return result; }
    public override string ToString() => Value.ToString();
}
public readonly struct Meters
{
    public readonly double Value;
    public Meters(double value) { Value = value; }
    public static implicit operator Meters(long value) => new Meters(value);
    public static implicit operator Meters(double value) => new Meters(value);
}
public static class Program
{
    static int Double(int x) => x * 2;
    static string Describe<TEnum>(TEnum value) where TEnum : struct, Enum => value + ":" + Enum.IsDefined(value) + ":" + Enum.GetValues<TEnum>().Length;
    static string Length(Meters m) => m.Value.ToString();
    public static void Main()
    {
        Console.WriteLine(sizeof(Small) + " " + sizeof(Level) + " " + sizeof(Op) + " " + sizeof(DayOfWeek) + sizeof(int) + sizeof(decimal));
        const int Size = sizeof(Level) * 2;
        Console.WriteLine(Size + " " + Describe(Small.Max) + " " + Describe((Op)9));
        Transform doubler = Double, other = x => x;
        Console.WriteLine((doubler == Double) + " " + (other == Double) + " " + (Double != doubler) + " " + (doubler == null));
        Natural big = ulong.MaxValue, small = 999, sum = small + 1;
        Console.WriteLine(Natural.Pow(2, 10) + " " + (small * 2) + " " + sum + " " + (big.Value == ulong.MaxValue) + " " + Length(5) + " " + Length(2.5) + " " + Length('a'));
    }
}
