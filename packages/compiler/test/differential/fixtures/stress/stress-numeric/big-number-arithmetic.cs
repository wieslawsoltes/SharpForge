using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.Text;

public sealed class Natural : IComparable<Natural>, IEquatable<Natural>
{
    private const uint Base = 1_000_000_000;
    private readonly uint[] limbs;
    private Natural(uint[] limbs) { this.limbs = Trim(limbs); }

    public static readonly Natural Zero = new Natural(new uint[0]);
    public static readonly Natural One = new Natural(new uint[] { 1 });
    public bool IsZero => limbs.Length == 0;
    public int Digits => IsZero ? 1 : (limbs.Length - 1) * 9 + limbs[limbs.Length - 1].ToString().Length;

    private static uint[] Trim(uint[] limbs)
    {
        int length = limbs.Length;
        while (length > 0 && limbs[length - 1] == 0) length--;
        if (length == limbs.Length) return limbs;
        var result = new uint[length];
        Array.Copy(limbs, result, length);
        return result;
    }

    public static implicit operator Natural(ulong value)
    {
        var limbs = new List<uint>();
        for (; value > 0; value /= Base) limbs.Add((uint)(value % Base));
        return new Natural(limbs.ToArray());
    }

    public static Natural Parse(string text)
    {
        var limbs = new List<uint>();
        for (int end = text.Length; end > 0; end -= 9)
        {
            int start = Math.Max(0, end - 9);
            limbs.Add(uint.Parse(text.Substring(start, end - start)));
        }
        return new Natural(limbs.ToArray());
    }

    public static Natural operator +(Natural a, Natural b)
    {
        var result = new uint[Math.Max(a.limbs.Length, b.limbs.Length) + 1];
        ulong carry = 0;
        for (int i = 0; i < result.Length; i++)
        {
            ulong sum = carry + (i < a.limbs.Length ? a.limbs[i] : 0u) + (i < b.limbs.Length ? b.limbs[i] : 0u);
            result[i] = (uint)(sum % Base);
            carry = sum / Base;
        }
        return new Natural(result);
    }

    public static Natural operator -(Natural a, Natural b)
    {
        if (a.CompareTo(b) < 0) throw new OverflowException("negative natural");
        var result = new uint[a.limbs.Length];
        long borrow = 0;
        for (int i = 0; i < result.Length; i++)
        {
            long difference = a.limbs[i] - borrow - (i < b.limbs.Length ? b.limbs[i] : 0);
            borrow = difference < 0 ? 1 : 0;
            result[i] = (uint)(difference + (borrow == 1 ? Base : 0));
        }
        return new Natural(result);
    }

    public static Natural operator *(Natural a, Natural b)
    {
        var result = new uint[a.limbs.Length + b.limbs.Length];
        for (int i = 0; i < a.limbs.Length; i++)
        {
            ulong carry = 0;
            for (int j = 0; j < b.limbs.Length || carry != 0; j++)
            {
                ulong current = result[i + j] + carry + (j < b.limbs.Length ? (ulong)a.limbs[i] * b.limbs[j] : 0);
                result[i + j] = (uint)(current % Base);
                carry = current / Base;
            }
        }
        return new Natural(result);
    }

    public (Natural Quotient, uint Remainder) DivRem(uint divisor)
    {
        if (divisor == 0) throw new DivideByZeroException();
        var result = new uint[limbs.Length];
        ulong remainder = 0;
        for (int i = limbs.Length - 1; i >= 0; i--)
        {
            ulong current = remainder * Base + limbs[i];
            result[i] = (uint)(current / divisor);
            remainder = current % divisor;
        }
        return (new Natural(result), (uint)remainder);
    }

    public static Natural Pow(Natural value, int exponent)
    {
        var result = One;
        for (; exponent > 0; exponent >>= 1, value *= value) if ((exponent & 1) != 0) result *= value;
        return result;
    }

    public int CompareTo(Natural other)
    {
        if (limbs.Length != other.limbs.Length) return limbs.Length.CompareTo(other.limbs.Length);
        for (int i = limbs.Length - 1; i >= 0; i--) if (limbs[i] != other.limbs[i]) return limbs[i].CompareTo(other.limbs[i]);
        return 0;
    }

    public bool Equals(Natural other) => other is not null && CompareTo(other) == 0;
    public override bool Equals(object obj) => Equals(obj as Natural);
    public override int GetHashCode() => limbs.Aggregate(17, (hash, limb) => unchecked(hash * 31 + (int)limb));
    public static bool operator ==(Natural a, Natural b) => a is null ? b is null : a.Equals(b);
    public static bool operator !=(Natural a, Natural b) => !(a == b);
    public static bool operator <(Natural a, Natural b) => a.CompareTo(b) < 0;
    public static bool operator >(Natural a, Natural b) => a.CompareTo(b) > 0;

    public override string ToString()
    {
        if (IsZero) return "0";
        var text = new StringBuilder(limbs[limbs.Length - 1].ToString());
        for (int i = limbs.Length - 2; i >= 0; i--) text.Append(limbs[i].ToString("D9"));
        return text.ToString();
    }
}

public static class Program
{
    private static Natural Factorial(int n)
    {
        Natural result = Natural.One;
        for (uint i = 2; i <= n; i++) result *= i;
        return result;
    }

    private static Natural Fibonacci(int n)
    {
        Natural a = Natural.Zero, b = Natural.One;
        for (int i = 0; i < n; i++) (a, b) = (b, a + b);
        return a;
    }

    public static void Main()
    {
        var f30 = Factorial(30);
        Console.WriteLine(f30 + " " + f30.Digits + " " + (f30.ToString() == Enumerable.Range(1, 30).Aggregate(BigInteger.One, (x, y) => x * y).ToString()));
        Console.WriteLine(Fibonacci(150) + " " + (Fibonacci(150).ToString() == Fib(150).ToString()) + " " + (Fibonacci(100) - Fibonacci(99) == Fibonacci(98)));
        var power = Natural.Pow(2, 200);
        Console.WriteLine(power + " " + (power.ToString() == BigInteger.Pow(2, 200).ToString()) + " " + Natural.Pow(10, 27).Digits + " " + Natural.Pow(7, 0));
        var parsed = Natural.Parse("123456789012345678901234567890");
        var (quotient, remainder) = parsed.DivRem(97);
        Console.WriteLine(parsed + " " + quotient + " r" + remainder + " " + (quotient * 97 + remainder == parsed) + " " + (parsed > f30) + " " + (parsed < f30) + " " + parsed.CompareTo(Natural.Parse("123456789012345678901234567890")));
        Natural big = ulong.MaxValue, small = 999_999_999;
        Console.WriteLine(big + " " + (big + 1) + " " + (small + 1) + " " + (big * big) + " " + (big - big).IsZero + " " + (Natural.Zero * big) + " " + Natural.Parse("000000000000000000042"));
        try { Console.WriteLine(small - big); } catch (OverflowException e) { Console.WriteLine(e.Message); }
        try { big.DivRem(0); } catch (DivideByZeroException) { Console.WriteLine("divide by zero"); }
        var set = new HashSet<Natural> { Factorial(10), Natural.Parse("3628800"), 3628800UL, Factorial(11) };
        var sorted = new[] { Natural.Pow(3, 50), Natural.Pow(2, 80), Factorial(25), Natural.Zero }.OrderBy(x => x).Select(x => x.Digits);
        Console.WriteLine(set.Count + " " + string.Join(",", sorted) + " " + Natural.Pow(99, 99).ToString().Sum(c => c - '0') + " " + BigInteger.Parse("1" + new string('0', 30)) % 1_000_007 + " " + BigInteger.ModPow(3, 1000, 1_000_007) + " " + (BigInteger.One << 70) + " " + BigInteger.GreatestCommonDivisor(1071, 462));
        static BigInteger Fib(int n) { BigInteger a = 0, b = 1; for (int i = 0; i < n; i++) (a, b) = (b, a + b); return a; }
    }
}
