using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Numerics;

public static class NumberTheory
{
    public static BigInteger Factorial(int n)
    {
        BigInteger result = BigInteger.One;
        for (int i = 2; i <= n; i++) result *= i;
        return result;
    }

    public static BigInteger Fibonacci(int n)
    {
        // Fast doubling: F(2k) = F(k) * (2F(k+1) - F(k)), F(2k+1) = F(k)^2 + F(k+1)^2.
        static (BigInteger, BigInteger) Pair(int k)
        {
            if (k == 0) return (BigInteger.Zero, BigInteger.One);
            var (a, b) = Pair(k >> 1);
            BigInteger c = a * ((b << 1) - a), d = a * a + b * b;
            return (k & 1) == 0 ? (c, d) : (d, c + d);
        }
        return Pair(n).Item1;
    }

    public static BigInteger Sqrt(BigInteger value)
    {
        if (value.Sign < 0) throw new ArgumentOutOfRangeException(nameof(value));
        if (value < 2) return value;
        BigInteger x = BigInteger.One << (int)((value.GetBitLength() + 1) / 2);
        while (true)
        {
            BigInteger y = (x + value / x) >> 1;
            if (y >= x) return x;
            x = y;
        }
    }

    public static BigInteger ModInverse(BigInteger a, BigInteger modulus)
    {
        BigInteger r0 = modulus, r1 = ((a % modulus) + modulus) % modulus, t0 = 0, t1 = 1;
        while (!r1.IsZero)
        {
            BigInteger q = BigInteger.DivRem(r0, r1, out BigInteger remainder);
            (r0, r1) = (r1, remainder);
            (t0, t1) = (t1, t0 - q * t1);
        }
        if (!r0.IsOne) throw new ArithmeticException("not invertible");
        return t0.Sign < 0 ? t0 + modulus : t0;
    }

    public static bool IsProbablePrime(BigInteger n)
    {
        if (n < 2) return false;
        int[] smallPrimes = { 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37 };
        foreach (int p in smallPrimes)
        {
            if (n == p) return true;
            if (n % p == 0) return false;
        }
        BigInteger d = n - 1;
        int r = 0;
        while (d.IsEven) { d >>= 1; r++; }
        foreach (int witness in smallPrimes)
        {
            BigInteger x = BigInteger.ModPow(witness, d, n);
            if (x.IsOne || x == n - 1) continue;
            bool composite = true;
            for (int i = 1; i < r && composite; i++)
            {
                x = BigInteger.ModPow(x, 2, n);
                if (x == n - 1) composite = false;
            }
            if (composite) return false;
        }
        return true;
    }
}

public static class Program
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private static string S(BigInteger value) => value.ToString(Inv);

    public static void Main()
    {
        BigInteger f25 = NumberTheory.Factorial(25), f52 = NumberTheory.Factorial(52);
        Console.WriteLine("25! = " + S(f25) + " = " + f25.ToString("N0", Inv) + " bits=" + f25.GetBitLength() + " long? " + (f25 > long.MaxValue) + " u128? " + (f25 <= (BigInteger)UInt128.MaxValue));
        Console.WriteLine("52! = " + f52.ToString("E10", Inv) + " digits=" + S(f52).Length + " trailing zeros=" + (S(f52).Length - S(f52).TrimEnd('0').Length)
            + " 52!/50! = " + S(f52 / NumberTheory.Factorial(50)) + " C(52,5) = " + S(f52 / (NumberTheory.Factorial(5) * NumberTheory.Factorial(47))));
        BigInteger fib300 = NumberTheory.Fibonacci(300);
        Console.WriteLine("F(300) = " + S(fib300) + " | F(90) as long = " + (long)NumberTheory.Fibonacci(90) + " | gcd(F(300), F(210)) = " + S(BigInteger.GreatestCommonDivisor(fib300, NumberTheory.Fibonacci(210)))
            + " = F(30)? " + (BigInteger.GreatestCommonDivisor(fib300, NumberTheory.Fibonacci(210)) == NumberTheory.Fibonacci(30)));

        BigInteger mersenne = BigInteger.Pow(2, 127) - 1;
        BigInteger parsed = BigInteger.Parse("-123456789012345678901234567890123456789", Inv);
        BigInteger hex = BigInteger.Parse("0FFFFFFFFFFFFFFFFFFFFFFFF", NumberStyles.HexNumber, Inv);
        Console.WriteLine("2^127-1 = " + S(mersenne) + " hex=" + mersenne.ToString("X", Inv) + " x8=" + new BigInteger(255).ToString("x8", Inv) + " neg=" + new BigInteger(-255).ToString("X", Inv)
            + " D30=" + new BigInteger(42).ToString("D30", Inv));
        Console.WriteLine("parsed sign=" + parsed.Sign + " abs digits=" + S(BigInteger.Abs(parsed)).Length + " %97=" + S(parsed % 97) + " /10^30=" + S(parsed / BigInteger.Pow(10, 30))
            + " rem=" + S(BigInteger.Remainder(parsed, 1000)) + " hex=" + S(hex) + " == 2^96-1 " + (hex == (BigInteger.One << 96) - 1) + " tryparse=" + BigInteger.TryParse("12x", NumberStyles.Integer, Inv, out _));

        BigInteger one = BigInteger.One, minusFive = -5;
        Console.WriteLine("shifts: " + S(one << 100) + " " + S((one << 100) >> 98) + " " + S(minusFive >> 1) + " " + S(minusFive << 3) + " " + S(minusFive / 2) + " " + S(minusFive % 3)
            + " | bits: " + S((mersenne & 0xFF) | 0x100) + " " + S(mersenne ^ (mersenne >> 1)) + " " + S(~BigInteger.Zero) + " " + S(~minusFive) + " popcount=" + S(BigInteger.PopCount(mersenne))
            + " tz=" + S(BigInteger.TrailingZeroCount(one << 77)) + " pow2=" + (one << 64).IsPowerOfTwo + " log2=" + BigInteger.Log(one << 64, 2).ToString("0.###", Inv));

        // Toy RSA with small fixed primes: encrypt, decrypt and sign.
        BigInteger p = 1_000_000_007, q = 998_244_353, n = p * q, phi = (p - 1) * (q - 1), e = 65537;
        BigInteger d = NumberTheory.ModInverse(e, phi);
        BigInteger message = BigInteger.Parse("314159265358979323", Inv);
        BigInteger cipher = BigInteger.ModPow(message, e, n), plain = BigInteger.ModPow(cipher, d, n);
        Console.WriteLine("rsa: n=" + S(n) + " d=" + S(d) + " e*d mod phi=" + S(e * d % phi) + " cipher=" + S(cipher) + " roundtrip=" + (plain == message)
            + " sig=" + S(BigInteger.ModPow(BigInteger.ModPow(42, d, n), e, n)) + " fermat=" + S(BigInteger.ModPow(2, p - 1, p)) + " negpow=" + S(BigInteger.ModPow(-7, 3, 10)));
        try { NumberTheory.ModInverse(6, 9); } catch (ArithmeticException ex) { Console.WriteLine("inverse of 6 mod 9: " + ex.Message); }

        var candidates = new BigInteger[] { 561, 7919, p, q, n, mersenne, BigInteger.Pow(2, 89) - 1, BigInteger.Pow(2, 67) - 1, BigInteger.Parse("3215031751", Inv), 1, 2 };
        Console.WriteLine("primes: " + string.Join(" ", candidates.Select(c => (NumberTheory.IsProbablePrime(c) ? "P" : "c") + c.GetBitLength())));
        BigInteger square = BigInteger.Pow(BigInteger.Parse("123456789123456789", Inv), 2);
        Console.WriteLine("isqrt: " + S(NumberTheory.Sqrt(square)) + " " + S(NumberTheory.Sqrt(square - 1)) + " " + S(NumberTheory.Sqrt(square + 1)) + " " + S(NumberTheory.Sqrt(BigInteger.Pow(10, 40)))
            + " " + S(NumberTheory.Sqrt(99)) + " " + S(NumberTheory.Sqrt(0)));

        var (quotient, remainder) = BigInteger.DivRem(BigInteger.Pow(7, 80), BigInteger.Pow(10, 40));
        Console.WriteLine("7^80 = " + S(quotient) + " * 10^40 + " + S(remainder) + " | digit sum of 2^200: " + S(BigInteger.Pow(2, 200)).Sum(c => c - '0')
            + " | bytes of 2^70: " + (one << 70).ToByteArray().Length + " | lcm(1..30) = " + S(Enumerable.Range(1, 30).Aggregate(one, (acc, k) => acc * k / BigInteger.GreatestCommonDivisor(acc, k))));

        var sorted = new List<BigInteger> { f25, mersenne, parsed, -f25, BigInteger.Zero, long.MinValue, ulong.MaxValue, fib300 % mersenne };
        sorted.Sort();
        Console.WriteLine("sorted signs: " + string.Join("", sorted.Select(v => v.Sign < 0 ? "-" : v.IsZero ? "0" : "+")) + " min bits=" + sorted[0].GetBitLength() + " max==mersenne " + (sorted[^1] == mersenne)
            + " compare: " + f25.CompareTo(mersenne) + " " + (f25 == BigInteger.Parse(S(f25), Inv)) + " " + BigInteger.Max(parsed, minusFive).IsOne + " " + (BigInteger.MinusOne < 0L) + " " + f25.Equals(15511210043330985984000000m));

        // Conversions to and from the fixed-width types, with overflow where the value does not fit.
        BigInteger wide = (BigInteger)ulong.MaxValue + 1;
        string Narrow(Func<object> convert) { try { return Convert.ToString(convert(), Inv); } catch (OverflowException) { return "ovf"; } }
        Console.WriteLine("conv: " + Narrow(() => (long)wide) + " " + Narrow(() => (ulong)(wide - 1)) + " " + Narrow(() => (int)minusFive) + " " + Narrow(() => (uint)minusFive) + " " + Narrow(() => (byte)(wide >> 57))
            + " " + Narrow(() => (double)wide) + " " + Narrow(() => (decimal)f25) + " " + Narrow(() => (decimal)(one << 96)) + " " + Narrow(() => (float)(one << 24) + 1f) + " " + S(new BigInteger(1e20))
            + " " + S((BigInteger)(-2.99)) + " " + S(new BigInteger(123.456m)) + " " + S((BigInteger)'A') + " " + ((double)f52).ToString("E6", Inv));

        Int128 i128 = Int128.MaxValue;
        UInt128 u128 = (UInt128)i128 * 2 + 1;
        Int128 product = (Int128)long.MaxValue * long.MaxValue;
        Console.WriteLine("int128: " + i128.ToString(Inv) + " " + (u128 == UInt128.MaxValue) + " " + product.ToString(Inv) + " " + ((BigInteger)product == BigInteger.Pow(long.MaxValue, 2))
            + " " + (product >> 64).ToString(Inv) + " " + unchecked(i128 + 1 == Int128.MinValue) + " " + Narrow(() => checked(i128 + 1)) + " " + (Int128)(-7) / 2 + "," + (Int128)(-7) % 2
            + " " + ((UInt128)1 << 100).ToString("X", Inv) + " " + Int128.Parse("-170141183460469231731687303715884105728", Inv).Equals(Int128.MinValue) + " " + UInt128.PopCount(u128) + " " + (long)(product % 1_000_000_007));
    }
}
