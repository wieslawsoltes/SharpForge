using System;
using System.Collections.Generic;
using System.Numerics;
using System.Runtime.InteropServices;

public struct Counter
{
    public int Value;
    public void Increment() => Value++;
    public readonly int Peek() => Value;
}

public struct Particle
{
    public int X, Y, Mass;
    public Counter Hits;
    public override readonly string ToString() => $"({X},{Y}) m{Mass} h{Hits.Value}";
}

public readonly struct Matrix3
{
    public readonly long A, B, C, D, E, F, G, H, I;
    public Matrix3(long a, long b, long c, long d, long e, long f, long g, long h, long i) { A = a; B = b; C = c; D = d; E = e; F = f; G = g; H = h; I = i; }
    public long Determinant => A * (E * I - F * H) - B * (D * I - F * G) + C * (D * H - E * G);
}

public static class Refs
{
    private static readonly Counter Shared = new Counter { Value = 100 };
    private static Counter _mutable = new Counter { Value = 100 };

    public static ref T Largest<T>(Span<T> span) where T : IComparable<T>
    {
        ref T best = ref span[0];
        for (int i = 1; i < span.Length; i++)
            if (span[i].CompareTo(best) > 0) best = ref span[i];
        return ref best;
    }

    public static ref readonly T FirstMatch<T>(ReadOnlySpan<T> span, Predicate<T> match, in T fallback)
    {
        foreach (ref readonly T item in span)
            if (match(item)) return ref item;
        return ref fallback;
    }

    public static ref int Pick(bool first, ref int a, ref int b) => ref (first ? ref a : ref b);
    public static void Swap<T>(ref T a, ref T b) => (a, b) = (b, a);

    public static int Partition<T>(Span<T> span, Func<T, bool> keepLeft)
    {
        int boundary = 0;
        for (int i = 0; i < span.Length; i++)
            if (keepLeft(span[i])) Swap(ref span[i], ref span[boundary++]);
        return boundary;
    }

    public static void QuickSort<T>(Span<T> span) where T : IComparable<T>
    {
        if (span.Length < 2) return;
        Swap(ref span[span.Length / 2], ref span[^1]);
        ref T pivot = ref span[^1];
        int store = 0;
        for (int i = 0; i < span.Length - 1; i++)
            if (span[i].CompareTo(pivot) < 0) Swap(ref span[i], ref span[store++]);
        Swap(ref span[store], ref pivot);
        QuickSort(span[..store]);
        QuickSort(span[(store + 1)..]);
    }

    public static void InsertionSort<T>(Span<T> span, Comparison<T> compare)
    {
        for (int i = 1; i < span.Length; i++)
        {
            T moving = span[i];
            int j = i;
            for (; j > 0 && compare(span[j - 1], moving) > 0; j--) span[j] = span[j - 1];
            span[j] = moving;
        }
    }

    public static void Rotate<T>(Span<T> span, int by)
    {
        by = (by % span.Length + span.Length) % span.Length;
        span.Reverse();
        span[..by].Reverse();
        span[by..].Reverse();
    }

    public static T Sum<T>(ReadOnlySpan<T> values) where T : struct, INumber<T>
    {
        T total = T.Zero;
        foreach (ref readonly T value in values) total += value;
        return total;
    }

    public static void MinMax<T>(ReadOnlySpan<T> values, out T min, out T max) where T : IComparable<T>
    {
        min = max = values[0];
        foreach (var value in values[1..])
        {
            if (value.CompareTo(min) < 0) min = value;
            else if (value.CompareTo(max) > 0) max = value;
        }
    }

    public static int BumpCopy(in Counter counter)
    {
        counter.Increment();
        counter.Increment();
        return counter.Peek();
    }

    public static int BumpReal(ref Counter counter)
    {
        counter.Increment();
        counter.Increment();
        return counter.Peek();
    }

    public static long Trace(in Matrix3 m, ref readonly Matrix3 other) => m.A + m.E + m.I + other.A + other.E + other.I;

    public static string SharedState()
    {
        Shared.Increment();
        _mutable.Increment();
        return Shared.Value + "/" + _mutable.Value + "/" + BumpCopy(Shared) + "/" + BumpCopy(in _mutable) + "/" + BumpReal(ref _mutable) + "/" + _mutable.Value;
    }
}

public static class Program
{
    public static void Main()
    {
        int[] numbers = { 5, 3, 9, 1, 7 };
        ref int largest = ref Refs.Largest<int>(numbers);
        largest = 0;
        Refs.Largest<int>(numbers) += 100;
        ref int cursor = ref numbers[0];
        cursor++;
        cursor = ref numbers[^1];
        cursor *= 2;
        Console.WriteLine(string.Join(",", numbers) + " " + largest + " " + cursor);

        int left = 1, right = 2;
        Refs.Pick(true, ref left, ref right) = 10;
        ref int chosen = ref Refs.Pick(false, ref left, ref right);
        chosen += 40;
        ref int ternary = ref (left > right ? ref left : ref right);
        ternary = -ternary;
        Refs.Swap(ref left, ref numbers[1]);
        Console.WriteLine($"{left} {right} {chosen} {numbers[1]}");

        var particles = new Particle[] { new() { X = 1, Mass = 5 }, new() { X = 2, Mass = 50 }, new() { X = 3, Mass = 7 } };
        ref Particle first = ref particles[0];
        first.Hits.Increment();
        ref int mass = ref particles[1].Mass;
        mass += 5;
        var copy = particles[2];
        copy.Hits.Increment();
        copy.Y = 99;
        foreach (ref Particle p in particles.AsSpan()) { p.Y = p.X * p.X; p.Hits.Increment(); }
        var none = new Particle { Mass = -1 };
        ref readonly Particle heavy = ref Refs.FirstMatch<Particle>(particles, p => p.Mass > 20, in none);
        ref readonly Particle missing = ref Refs.FirstMatch<Particle>(particles, p => p.Mass > 500, in none);
        heavy.Hits.Increment();
        Console.WriteLine(string.Join(" ", particles) + " | " + copy + " | " + heavy + " | " + missing.Mass + " " + heavy.Hits.Peek());

        var list = new List<Particle>(particles);
        var fromList = list[0];
        fromList.Mass = 1000;
        foreach (ref Particle p in CollectionsMarshal.AsSpan(list)) p.Mass *= 2;
        Console.WriteLine(string.Join(" ", list) + " " + fromList.Mass + " " + particles[0].Mass);

        var counter = new Counter { Value = 1 };
        Console.WriteLine($"{Refs.BumpCopy(in counter)} {counter.Value} {Refs.BumpCopy(counter)} {counter.Value} {Refs.BumpReal(ref counter)} {counter.Value} {Refs.SharedState()} {Refs.SharedState()}");
        var identity = new Matrix3(1, 0, 0, 0, 1, 0, 0, 0, 1);
        var skew = new Matrix3(2, -1, 0, 4, 3, 5, 1, 1, -2);
        Console.WriteLine($"{Refs.Trace(in identity, in skew)} {Refs.Trace(skew, ref skew)} {identity.Determinant} {skew.Determinant}");

        Span<int> data = stackalloc int[] { 42, -7, 13, 0, 99, -7, 5, 28, 13, 1 };
        Span<int> working = stackalloc int[data.Length];
        data.CopyTo(working);
        Console.WriteLine(string.Join(",", data.ToArray()) + " " + data.SequenceEqual(working) + " " + data.IndexOf(13) + " " + data.LastIndexOf(13) + " " + Refs.Largest(data));
        int evens = Refs.Partition(working, n => n % 2 == 0);
        Console.WriteLine(string.Join(",", working.ToArray()) + " evens=" + evens);
        Refs.QuickSort(working[..evens]);
        Refs.QuickSort(working[evens..]);
        Console.WriteLine(string.Join(",", working.ToArray()));
        Refs.QuickSort(working);
        Refs.MinMax<int>(working, out int min, out int max);
        Console.WriteLine(string.Join(",", working.ToArray()) + $" min={min} max={max} sum={Refs.Sum<int>(data)} search={working.BinarySearch(28)} {working.BinarySearch(6) < 0}");
        Refs.Rotate(working, 3);
        Console.WriteLine(string.Join(",", working.ToArray()));
        Refs.Rotate(working[2..^2], -1);
        Console.WriteLine(string.Join(",", working.ToArray()));

        string[] words = { "pear", "Fig", "apple", "kiwi", "banana", "date" };
        Refs.InsertionSort<string>(words, (a, b) => a.Length != b.Length ? a.Length - b.Length : string.CompareOrdinal(a, b));
        Console.WriteLine(string.Join(",", words) + " " + Refs.Largest<string>(words) + " " + Refs.FirstMatch<string>(words, w => w.Length == 5, "none") + " " + Refs.FirstMatch<string>(words, w => w.Length == 7, "none"));
        Refs.QuickSort<string>(words.AsSpan(1, 4));
        Refs.MinMax<string>(words, out var firstWord, out var lastWord);
        Console.WriteLine(string.Join(",", words) + " " + firstWord + ".." + lastWord);
        double[] reals = { 1.5, 2.25, -0.75 };
        Console.WriteLine(Refs.Sum<double>(reals) == 3.0 ? "sum 3 " + Refs.Sum<long>(new long[] { long.MaxValue - 1, 1 }) + " " + Refs.Sum<byte>(stackalloc byte[] { 200, 100 }) : "sum mismatch");
    }
}
