using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

public interface IRandom
{
    uint NextUInt32();
    int Next(int exclusiveMax) => (int)((ulong)NextUInt32() * (ulong)exclusiveMax >> 32);
    double NextDouble() => NextUInt32() / 4294967296.0;
}

public sealed class Lcg : IRandom
{
    private uint state;
    public Lcg(uint seed) { state = seed; }
    public uint NextUInt32() => state = unchecked(state * 1664525u + 1013904223u);
}

public struct XorShift64 : IRandom
{
    private ulong state;
    public XorShift64(ulong seed) { state = seed == 0 ? 0x9E3779B97F4A7C15UL : seed; }
    public uint NextUInt32()
    {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        return (uint)(state >> 32);
    }
}

public sealed class Pcg32 : IRandom
{
    private ulong state;
    private readonly ulong increment;
    public Pcg32(ulong seed, ulong sequence)
    {
        increment = sequence << 1 | 1;
        NextUInt32();
        state += seed;
        NextUInt32();
    }
    public uint NextUInt32()
    {
        ulong old = state;
        state = unchecked(old * 6364136223846793005UL + increment);
        uint shifted = (uint)((old >> 18 ^ old) >> 27);
        int rotation = (int)(old >> 59);
        return shifted >> rotation | shifted << (-rotation & 31);
    }
}

public static class Hash
{
    public static uint Fnv1a(ReadOnlySpan<byte> data)
    {
        uint hash = 2166136261;
        foreach (byte b in data) hash = unchecked((hash ^ b) * 16777619);
        return hash;
    }

    public static uint Adler32(ReadOnlySpan<byte> data)
    {
        uint a = 1, b = 0;
        foreach (byte value in data)
        {
            a = (a + value) % 65521;
            b = (b + a) % 65521;
        }
        return b << 16 | a;
    }

    public static uint Murmur3(ReadOnlySpan<byte> data, uint seed)
    {
        const uint c1 = 0xcc9e2d51, c2 = 0x1b873593;
        uint hash = seed;
        int blocks = data.Length / 4;
        unchecked
        {
            for (int i = 0; i < blocks; i++)
            {
                uint k = BitConverter.ToUInt32(data.Slice(i * 4, 4));
                k *= c1; k = k << 15 | k >> 17; k *= c2;
                hash ^= k; hash = hash << 13 | hash >> 19; hash = hash * 5 + 0xe6546b64;
            }
            uint tail = 0;
            int rest = data.Length & 3, offset = blocks * 4;
            if (rest == 3) tail ^= (uint)data[offset + 2] << 16;
            if (rest >= 2) tail ^= (uint)data[offset + 1] << 8;
            if (rest >= 1) { tail ^= data[offset]; tail *= c1; tail = tail << 15 | tail >> 17; tail *= c2; hash ^= tail; }
            hash ^= (uint)data.Length;
            hash ^= hash >> 16; hash *= 0x85ebca6b; hash ^= hash >> 13; hash *= 0xc2b2ae35; hash ^= hash >> 16;
        }
        return hash;
    }

    public static ulong Djb2(string text) => text.Aggregate(5381UL, (hash, c) => unchecked(hash * 33 + c));
    public static int Luhn(string digits)
    {
        int sum = 0;
        for (int i = digits.Length - 1, position = 0; i >= 0; i--, position++)
        {
            int digit = digits[i] - '0';
            if (position % 2 == 1) { digit *= 2; if (digit > 9) digit -= 9; }
            sum += digit;
        }
        return sum % 10;
    }
}

public static class Program
{
    private static void Shuffle<T>(IList<T> items, IRandom random)
    {
        for (int i = items.Count - 1; i > 0; i--)
        {
            int j = random.Next(i + 1);
            (items[i], items[j]) = (items[j], items[i]);
        }
    }

    private static string Sample<TRandom>(TRandom random, int count) where TRandom : IRandom
    {
        var values = new uint[count];
        for (int i = 0; i < count; i++) values[i] = random.NextUInt32();
        return string.Join(" ", values.Select(v => v.ToString("X8")));
    }

    public static void Main()
    {
        Console.WriteLine(Sample(new Lcg(42), 4));
        Console.WriteLine(Sample(new XorShift64(42), 4) + " | " + Sample(new XorShift64(0), 1));
        Console.WriteLine(Sample(new Pcg32(42, 54), 4));
        IRandom random = new Lcg(2024);
        var deck = Enumerable.Range(1, 12).ToList();
        Shuffle(deck, random);
        int[] buckets = new int[5];
        for (int i = 0; i < 10000; i++) buckets[random.Next(5)]++;
        double mean = Enumerable.Range(0, 1000).Select(_ => random.NextDouble()).Average();
        Console.WriteLine(string.Join(",", deck) + " " + string.Join("/", buckets) + " " + buckets.Sum() + " " + (mean > 0.45 && mean < 0.55) + " " + mean.ToString("F6", System.Globalization.CultureInfo.InvariantCulture));
        var boxedStruct = (IRandom)new XorShift64(7);
        uint first = boxedStruct.NextUInt32(), second = boxedStruct.NextUInt32();
        var copy = new XorShift64(7);
        var alias = copy;
        Console.WriteLine((first != second) + " " + (copy.NextUInt32() == first) + " " + (alias.NextUInt32() == first) + " " + (copy.NextUInt32() == second) + " " + boxedStruct.Next(100) + " " + new Random(123).Next(1000).GetType().Name);

        byte[] data = Encoding.UTF8.GetBytes("The quick brown fox jumps over the lazy dog");
        Console.WriteLine(Hash.Fnv1a(data).ToString("x8") + " " + Hash.Adler32(data).ToString("x8") + " " + Hash.Murmur3(data, 0).ToString("x8") + " " + Hash.Murmur3(data.AsSpan(0, 5), 1).ToString("x8") + " " + Hash.Murmur3(default, 0).ToString("x8") + " " + Hash.Fnv1a(ReadOnlySpan<byte>.Empty).ToString("x8") + " " + Hash.Djb2("hello") + " " + Hash.Adler32(Encoding.ASCII.GetBytes("Wikipedia")).ToString("X"));
        Console.WriteLine(string.Join(" ", new[] { "4539578763621486", "4539578763621487", "79927398713", "0", "" }.Select(Hash.Luhn)));
        var table = new Dictionary<uint, List<string>>();
        foreach (var word in "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu".Split(' '))
        {
            uint bucket = Hash.Fnv1a(Encoding.ASCII.GetBytes(word)) % 5;
            if (!table.TryGetValue(bucket, out var list)) table[bucket] = list = new List<string>();
            list.Add(word);
        }
        Console.WriteLine(string.Join(" | ", table.OrderBy(pair => pair.Key).Select(pair => pair.Key + ":" + string.Join(",", pair.Value))));
        long gcd = Gcd(1071, 462), lcm = 1071L * 462 / gcd;
        Console.WriteLine(gcd + " " + lcm + " " + ModPow(4, 13, 497) + " " + ModPow(2, 62, long.MaxValue) + " " + string.Join(",", Enumerable.Range(1, 30).Where(IsPrime)) + " " + IsPrime(2147483647) + " " + string.Join("*", Factor(360)) + " " + string.Join("*", Factor(97)) + " " + Collatz(27));
        static long Gcd(long a, long b) => b == 0 ? a : Gcd(b, a % b);
        static long ModPow(long value, long exponent, long modulus)
        {
            long result = 1;
            for (value %= modulus; exponent > 0; exponent >>= 1)
            {
                if ((exponent & 1) == 1) result = (long)((System.Numerics.BigInteger)result * value % modulus);
                value = (long)((System.Numerics.BigInteger)value * value % modulus);
            }
            return result;
        }
        static bool IsPrime(int n)
        {
            if (n < 2) return false;
            for (long d = 2; d * d <= n; d++) if (n % d == 0) return false;
            return true;
        }
        static IEnumerable<int> Factor(int n)
        {
            for (int d = 2; d * d <= n; d++) while (n % d == 0) { yield return d; n /= d; }
            if (n > 1) yield return n;
        }
        static int Collatz(long n) { int steps = 0; while (n != 1) { n = (n & 1) == 0 ? n >> 1 : 3 * n + 1; steps++; } return steps; }
    }
}
